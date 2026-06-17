/**
 * 验证工具函数
 */

/**
 * 验证 API Key 字符集（仅允许 ASCII 可见字符）
 */
export function isValidApiKeyCharset(key: string): boolean {
  if (!key) return false;
  return /^[\x21-\x7E]+$/.test(key);
}

/**
 * 账号 proxy_url 校验结果。
 * - `valid: false` + `reason: 'empty'`：未填写（住宅代理为必填）。
 * - `valid: false` + `reason: 'invalid'`：填了但 scheme/格式非法。
 * - `valid: true`：可提交。
 */
export type ProxyUrlValidationReason = 'empty' | 'invalid';

export interface ProxyUrlValidationResult {
  valid: boolean;
  reason?: ProxyUrlValidationReason;
}

/**
 * 账号 proxy_url 合法 scheme 集合，对齐 core proxyutil（core#26/#27 服务端守卫）。
 * core 接受 http/https/socks5/socks5h 系列出站代理；前端必填 + 格式校验在提交前拦截，
 * 避免账号 proxy_url 落空导致请求直连暴露真 IP。
 */
const PROXY_URL_ALLOWED_SCHEMES = new Set(['http', 'https', 'socks5', 'socks5h']);

/**
 * 校验单个账号的 proxy_url。空值视为「必填未填」，非法 scheme/无 host 视为「格式非法」。
 * 必须填写住宅代理，且只接受 core proxyutil 支持的 scheme。
 */
export function validateProxyUrl(value: string): ProxyUrlValidationResult {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return { valid: false, reason: 'empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'invalid' };
  }

  // URL 解析出的 protocol 形如 "socks5:"，去掉结尾冒号后与允许集对齐。
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (!PROXY_URL_ALLOWED_SCHEMES.has(scheme)) {
    return { valid: false, reason: 'invalid' };
  }
  if (!parsed.hostname) {
    return { valid: false, reason: 'invalid' };
  }

  return { valid: true };
}
