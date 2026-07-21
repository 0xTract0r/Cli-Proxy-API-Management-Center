/**
 * 常量定义
 * 从原项目 src/utils/constants.js 迁移
 */

import type { Language } from '@/types';

const defineLanguageOrder = <T extends readonly Language[]>(
  languages: T & ([Language] extends [T[number]] ? unknown : never)
) => languages;

// 缓存过期时间（毫秒）
export const CACHE_EXPIRY_MS = 30 * 1000; // 与基线保持一致，减少管理端压力

// 网络与版本信息
export const DEFAULT_API_PORT = 8317;
export const MANAGEMENT_API_PREFIX = '/v0/management';
export const REQUEST_TIMEOUT_MS = 30 * 1000;
export const CPA_VERSION_HEADER_KEYS = ['x-cpa-version'];
export const CPA_BUILD_DATE_HEADER_KEYS = ['x-cpa-build-date'];
export const HOME_VERSION_HEADER_KEYS = ['x-cpa-home-version'];
export const HOME_BUILD_DATE_HEADER_KEYS = ['x-cpa-home-build-date'];
export const VERSION_HEADER_KEYS = [
  ...HOME_VERSION_HEADER_KEYS,
  ...CPA_VERSION_HEADER_KEYS,
  'x-server-version'
];
export const BUILD_DATE_HEADER_KEYS = [
  ...HOME_BUILD_DATE_HEADER_KEYS,
  ...CPA_BUILD_DATE_HEADER_KEYS,
  'x-server-build-date'
];

// 日志相关
export const LOGS_TIMEOUT_MS = 60 * 1000;

// 认证文件分页
export const MAX_AUTH_FILE_SIZE = 10 * 1024 * 1024;

// 本地存储键名
export const STORAGE_KEY_AUTH = 'cli-proxy-auth';
export const STORAGE_KEY_THEME = 'cli-proxy-theme';
export const STORAGE_KEY_LANGUAGE = 'cli-proxy-language';
// 农场编排器是独立后端（独立 base URL + 独立 admin key），不复用 CPA 管理会话，
// 因此单独存一份配置，不并入 STORAGE_KEY_AUTH。
export const STORAGE_KEY_FARM = 'cli-proxy-farm';

// 农场编排器请求超时（绑定/解绑涉及远端 docker run/stop，放宽于常规管理请求）
export const FARM_REQUEST_TIMEOUT_MS = 30 * 1000;
// 容器池轮询间隔：够快看到状态变化，又不至于把编排器打爆
export const FARM_CONTAINERS_POLL_INTERVAL_MS = 15 * 1000;
// 概览带 / 告警面板轮询间隔（P0-9）：KPI 聚合和跨容器告警不需要像容器池那样
// 15s 一刷（本身就是对既有容器数据的二次聚合，Poller 巡检本身是 60s 一轮，
// 刷太快没有新信息，只多打编排器请求）。
export const FARM_OVERVIEW_POLL_INTERVAL_MS = 30 * 1000;
export const FARM_ALERTS_POLL_INTERVAL_MS = 30 * 1000;

// 语言配置
export const LANGUAGE_ORDER = defineLanguageOrder(['zh-CN', 'zh-TW', 'en', 'ru'] as const);
export const LANGUAGE_LABEL_KEYS: Record<Language, string> = {
  'zh-CN': 'language.chinese',
  'zh-TW': 'language.chinese_tw',
  en: 'language.english',
  ru: 'language.russian'
};
export const SUPPORTED_LANGUAGES = LANGUAGE_ORDER;

// 通知持续时间
export const NOTIFICATION_DURATION_MS = 3000;
