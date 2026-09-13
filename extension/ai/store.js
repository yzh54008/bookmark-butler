/**
 * ai/store.js — 模型配置的本地存储
 *
 * 安全约定（刻意为之，别改）：
 *  - 只用 chrome.storage.local，绝不用 chrome.storage.sync —— sync 会把 Key 上传到云端账号。
 *  - 不对任何第三方发送 Key，除用户自己填的那个端点。
 *  - 界面上永远只显示掩码，日志里永不打印 Key。
 */
import { DEFAULT_PROVIDER, getProvider } from './provider.js';

const KEY = 'ai_config';

export const DEFAULT_CONFIG = {
  provider: DEFAULT_PROVIDER,
  baseUrl: '',            // 留空则用预设
  apiKey: '',
  model: '',
  temperature: 0.2,
  maxTokens: 4096,
  concurrency: 2,         // 并发请求数
  batchSize: 40,          // 每批送多少条书签
  hostBatchSize: 60,      // 每批送多少个域名
  language: 'zh',         // 目录命名语言
  businessContext: '',    // 业务背景（可选，显著提升归类质量）
  keepExistingTops: false,// 沿用现有顶层目录
  sendFullUrl: false,     // 是否把完整 URL 发给模型（默认只发域名+标题）
  autoSplitHosts: true,   // 是否对「一域名多用途」自动逐条细判
  useLocalRulesFallback: true, // 模型失败时回退到本地规则引擎
  history: [],            // 最近几次运行的用量记录
};

export async function loadConfig() {
  const r = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_CONFIG, ...(r[KEY] || {}) };
}

export async function saveConfig(patch) {
  const cur = await loadConfig();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function clearKey() {
  return saveConfig({ apiKey: '' });
}

/** 解析出真正生效的 baseUrl / model（预设 + 覆盖） */
export function resolveEndpoint(cfg) {
  const p = getProvider(cfg.provider);
  const baseUrl = (cfg.baseUrl || '').trim() || p.baseUrl;
  const model = (cfg.model || '').trim() || p.defaultModel || '';
  return { baseUrl, model, preset: p, jsonMode: cfg.jsonMode || p.jsonMode };
}

/** 掩码显示：sk-abc…xyz，绝不回显完整 Key */
export function maskKey(k) {
  const s = String(k || '');
  if (!s) return '';
  if (s.length <= 10) return s.slice(0, 2) + '••••' + s.slice(-2);
  return s.slice(0, 6) + '••••••' + s.slice(-4);
}

/** 配置是否已可用 */
export function isConfigured(cfg) {
  const { baseUrl, model } = resolveEndpoint(cfg);
  if (!baseUrl || !model) return false;
  // 本地端点（Ollama）允许空 Key
  let local = false;
  try {
    const u = new URL(baseUrl);
    local = ['127.0.0.1', 'localhost', '::1'].includes(u.hostname);
  } catch { /* ignore */ }
  if (local) return true;
  return !!String(cfg.apiKey || '').trim();
}

/** 记录一次运行（用于展示历史用量，最多留 20 条） */
export async function pushHistory(rec) {
  const cfg = await loadConfig();
  const history = [{ at: Date.now(), ...rec }, ...(cfg.history || [])].slice(0, 20);
  await saveConfig({ history });
  return history;
}
