import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isOAuthCancelSuccessful, oauthApi } from '@/services/api/oauth';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import type { UseFarmAccountsResult } from './useFarmAccounts';

export interface FarmReauthState {
  status: 'starting' | 'polling' | 'error';
  url?: string;
  state?: string;
  error?: string;
  // 手动回调 URL 入口状态（对齐 authFiles 侧 useAuthFilesReauth）：远程管理端
  // （cpamp 部署在 201，浏览器打开授权页跳转的是 http://localhost:.../auth/
  // callback，回调回不到发起授权请求的管理端 origin）下，自动轮询等不到
  // oauthApi.getAuthStatus 变 ok，必须让用户手动粘贴浏览器地址栏里的完整
  // 回调 URL，前端解析后调用同一个 oauthApi.submitCallback 完成授权。
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
}

export interface UseFarmReauthOptions {
  reload: UseFarmAccountsResult['reload'];
}

export interface UseFarmReauthResult {
  // 按账号名索引，供 FarmAccountsPanel 只让被操作的那一行进入轮询/loading 态。
  reauthStates: Record<string, FarmReauthState>;
  startReauth: (accountName: string) => void;
  copyReauthLink: (accountName: string) => Promise<void>;
  openReauthLink: (accountName: string) => void;
  cancelReauth: (accountName: string) => Promise<void>;
  updateReauthCallbackUrl: (accountName: string, callbackUrl: string) => void;
  submitReauthCallback: (accountName: string) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : '';
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

/**
 * 农场账号「重新授权」按钮（Q5 缺陷修复）：原实现是裸
 * `<a href={account.reauth_url} target="_blank">` 整页跳转，而 reauth_url 实际
 * 指向 `GET /v0/management/anthropic-auth-url`——这是给程序调用、返回
 * `{url, state}` JSON 的端点，不是给人看的授权页，用户点击后看到的是裸 JSON。
 *
 * 改走仓库里 authFiles 侧 useAuthFilesReauth 已验证过的正确流程：二次确认 →
 * oauthApi.startAuth('anthropic', {authName}) 拿真正的 OAuth 授权 URL + state →
 * 复制/新开窗口把 URL 交给用户 → 轮询 oauthApi.getAuthStatus(state) 直到
 * 成功/取消/失败 → reload() 刷新账号列表。测试端所有农场账号都在同一个 CPA
 * 实例（18417）上，管理前端 apiClient 已经指向它，这里纯前端接线即可，不需要
 * 改后端。
 *
 * 同时对齐 authFiles 侧保留的第二条路径：远程管理端（cpamp 部署在 201，
 * operator 通过浏览器访问）下，OAuth provider 跳转的回调地址是
 * `http://localhost:.../auth/callback?code=...&state=...`，回不到发起授权
 * 请求的管理端 origin，自动轮询永远等不到成功。此时用户需要自己从浏览器地址
 * 栏复制这条本地回调 URL，粘贴进手动入口，前端调用同一个
 * oauthApi.submitCallback(provider, redirectUrl) 完成授权后端登记，随后仍由
 * 既有轮询确认最终状态。两条路径并存：能自动回调成功就走轮询成功分支，回不
 * 来则由用户手动提交。
 *
 * 固定传 provider='anthropic'：农场账号页目前只在 account.reauth_url 非空时
 * 才渲染重新授权入口，经验上只有 anthropic（Claude）account 会拿到该字段，
 * 非 claude provider 该字段为空、继续走「—」占位分支，不会调用到这里。
 */
export function useFarmReauth(options: UseFarmReauthOptions): UseFarmReauthResult {
  const { reload } = options;
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const [reauthStates, setReauthStates] = useState<Record<string, FarmReauthState>>({});
  const pollingTimersRef = useRef<Record<string, number>>({});

  const clearPollingTimer = useCallback((accountName: string) => {
    const timer = pollingTimersRef.current[accountName];
    if (timer) {
      window.clearInterval(timer);
      delete pollingTimersRef.current[accountName];
    }
  }, []);

  // 卸载时清掉所有在途轮询计时器，避免组件卸载后继续 setState。
  useEffect(() => {
    return () => {
      Object.values(pollingTimersRef.current).forEach((timer) => window.clearInterval(timer));
      pollingTimersRef.current = {};
    };
  }, []);

  const clearReauthState = useCallback((accountName: string) => {
    setReauthStates((prev) => {
      if (!(accountName in prev)) return prev;
      const next = { ...prev };
      delete next[accountName];
      return next;
    });
  }, []);

  const copyReauthLink = useCallback(
    async (accountName: string) => {
      const url = reauthStates[accountName]?.url;
      if (!url) return;
      const copied = await copyToClipboard(url);
      showNotification(
        copied
          ? t('farm.accountHealth.reauthCopySuccess', { defaultValue: 'Authorization link copied' })
          : t('farm.accountHealth.reauthCopyFailed', { defaultValue: 'Failed to copy authorization link' }),
        copied ? 'success' : 'error'
      );
    },
    [reauthStates, showNotification, t]
  );

  const openReauthLink = useCallback(
    (accountName: string) => {
      const url = reauthStates[accountName]?.url;
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [reauthStates]
  );

  const startPolling = useCallback(
    (accountName: string, state: string) => {
      clearPollingTimer(accountName);

      const timer = window.setInterval(async () => {
        try {
          const response = await oauthApi.getAuthStatus(state);
          if (response.status === 'ok') {
            clearPollingTimer(accountName);
            clearReauthState(accountName);
            await reload();
            showNotification(t('farm.notification.reauthSuccess', { id: accountName }), 'success');
            return;
          }

          if (response.status === 'cancelled') {
            clearPollingTimer(accountName);
            clearReauthState(accountName);
            showNotification(
              response.error?.trim() ||
                t('farm.accountHealth.reauthCancelled', { defaultValue: 'Re-authentication cancelled' }),
              'info'
            );
            return;
          }

          if (response.status === 'error') {
            clearPollingTimer(accountName);
            const failureMessage = response.error?.trim() || '';
            setReauthStates((prev) => ({
              ...prev,
              [accountName]: { ...(prev[accountName] ?? {}), status: 'error', error: failureMessage },
            }));
            showNotification(
              `${t('farm.error.reauthFailed', { defaultValue: 'Failed to re-authenticate' })}${
                failureMessage ? `: ${failureMessage}` : ''
              }`,
              'error'
            );
          }
        } catch (err: unknown) {
          clearPollingTimer(accountName);
          const errorMessage = err instanceof Error ? err.message : '';
          setReauthStates((prev) => ({
            ...prev,
            [accountName]: { ...(prev[accountName] ?? {}), status: 'error', error: errorMessage },
          }));
          showNotification(
            `${t('farm.error.reauthFailed', { defaultValue: 'Failed to re-authenticate' })}${
              errorMessage ? `: ${errorMessage}` : ''
            }`,
            'error'
          );
        }
      }, 3000);

      pollingTimersRef.current[accountName] = timer;
    },
    [clearPollingTimer, clearReauthState, reload, showNotification, t]
  );

  const actuallyStartReauth = useCallback(
    async (accountName: string) => {
      clearPollingTimer(accountName);
      setReauthStates((prev) => ({ ...prev, [accountName]: { status: 'starting' } }));

      try {
        const response = await oauthApi.startAuth('anthropic', { authName: accountName });
        if (!response.url || !response.state) {
          throw new Error(t('farm.error.reauthFailed', { defaultValue: 'Failed to re-authenticate' }));
        }
        setReauthStates((prev) => ({
          ...prev,
          [accountName]: {
            status: 'polling',
            url: response.url,
            state: response.state,
            callbackUrl: '',
            callbackSubmitting: false,
            callbackStatus: undefined,
            callbackError: undefined,
          },
        }));
        startPolling(accountName, response.state);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        setReauthStates((prev) => ({
          ...prev,
          [accountName]: { status: 'error', error: errorMessage },
        }));
        showNotification(
          `${t('farm.error.reauthFailed', { defaultValue: 'Failed to re-authenticate' })}${
            errorMessage ? `: ${errorMessage}` : ''
          }`,
          'error'
        );
      }
    },
    [clearPollingTimer, showNotification, startPolling, t]
  );

  const startReauth = useCallback(
    (accountName: string) => {
      showConfirmation({
        title: t('farm.accountHealth.reauthConfirmTitle', { defaultValue: 'Re-authenticate this account?' }),
        message: t('farm.accountHealth.reauthConfirmMessage', {
          defaultValue:
            'The current account stays unchanged until the new authorization completes. You can cancel at any time.',
        }),
        variant: 'primary',
        confirmText: t('farm.accountHealth.reauthConfirmAction', { defaultValue: 'Continue' }),
        cancelText: t('common.cancel'),
        onConfirm: async () => {
          await actuallyStartReauth(accountName);
        },
      });
    },
    [actuallyStartReauth, showConfirmation, t]
  );

  const cancelReauth = useCallback(
    async (accountName: string) => {
      clearPollingTimer(accountName);
      const state = reauthStates[accountName]?.state;

      if (state) {
        try {
          const response = await oauthApi.cancelAuth(state);
          if (!isOAuthCancelSuccessful(response)) {
            const failureMessage = response.error?.trim() || '';
            showNotification(
              `${t('farm.accountHealth.reauthCancelFailed', {
                defaultValue: 'Failed to cancel re-authentication',
              })}${failureMessage ? `: ${failureMessage}` : ''}`,
              'error'
            );
            return;
          }
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : '';
          showNotification(
            `${t('farm.accountHealth.reauthCancelFailed', {
              defaultValue: 'Failed to cancel re-authentication',
            })}${errorMessage ? `: ${errorMessage}` : ''}`,
            'error'
          );
          return;
        }
      }

      clearReauthState(accountName);
      showNotification(
        t('farm.accountHealth.reauthCancelled', { defaultValue: 'Re-authentication cancelled' }),
        'info'
      );
    },
    [clearPollingTimer, clearReauthState, reauthStates, showNotification, t]
  );

  const updateReauthCallbackUrl = useCallback((accountName: string, callbackUrl: string) => {
    setReauthStates((prev) => {
      const current = prev[accountName];
      if (!current) return prev;
      return {
        ...prev,
        [accountName]: {
          ...current,
          callbackUrl,
          callbackStatus: undefined,
          callbackError: undefined,
        },
      };
    });
  }, []);

  const submitReauthCallback = useCallback(
    async (accountName: string) => {
      const current = reauthStates[accountName];
      if (!current) return;

      const redirectUrl = (current.callbackUrl || '').trim();
      if (!redirectUrl) {
        showNotification(
          t('farm.accountHealth.reauthCallbackRequired', {
            defaultValue: 'Please paste the full redirect URL first.',
          }),
          'warning'
        );
        return;
      }

      setReauthStates((prev) => {
        const existing = prev[accountName];
        if (!existing) return prev;
        return {
          ...prev,
          [accountName]: {
            ...existing,
            callbackSubmitting: true,
            callbackStatus: undefined,
            callbackError: undefined,
          },
        };
      });

      try {
        // 农场账号页固定 provider='anthropic'（见顶部注释），与 startReauth 一致。
        await oauthApi.submitCallback('anthropic', redirectUrl);
        setReauthStates((prev) => {
          const existing = prev[accountName];
          if (!existing) return prev;
          return {
            ...prev,
            [accountName]: {
              ...existing,
              callbackSubmitting: false,
              callbackStatus: 'success',
              callbackError: undefined,
            },
          };
        });
        showNotification(
          t('farm.accountHealth.reauthCallbackSuccess', {
            defaultValue: 'Callback URL submitted. Continue waiting for authentication.',
          }),
          'success'
        );
      } catch (err: unknown) {
        const status = getErrorStatus(err);
        const message = getErrorMessage(err);
        const errorMessage =
          status === 404
            ? t('farm.accountHealth.reauthCallbackUpgradeHint', {
                defaultValue: 'Please update CLI Proxy API or check the connection.',
              })
            : message || undefined;

        setReauthStates((prev) => {
          const existing = prev[accountName];
          if (!existing) return prev;
          return {
            ...prev,
            [accountName]: {
              ...existing,
              callbackSubmitting: false,
              callbackStatus: 'error',
              callbackError: errorMessage,
            },
          };
        });

        const callbackErrorPrefix = t('farm.accountHealth.reauthCallbackError', {
          defaultValue: 'Failed to submit callback URL',
        });
        const notificationMessage = errorMessage
          ? `${callbackErrorPrefix}: ${errorMessage}`
          : callbackErrorPrefix;
        showNotification(notificationMessage, 'error');
      }
    },
    [reauthStates, showNotification, t]
  );

  return {
    reauthStates,
    startReauth,
    copyReauthLink,
    openReauthLink,
    cancelReauth,
    updateReauthCallbackUrl,
    submitReauthCallback,
  };
}
