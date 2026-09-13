/**
 * background.js — Service Worker
 * 职责：首次安装时写入默认规则、安装后打开管理台、维护规则版本升级。
 */
import { DEFAULT_RULES } from './rules.js';

const RULES_KEY = 'classify_rules';
const RULES_VERSION = 1;

chrome.runtime.onInstalled.addListener(async (details) => {
  const r = await chrome.storage.local.get(RULES_KEY);
  const existing = r[RULES_KEY];

  if (!existing) {
    await chrome.storage.local.set({ [RULES_KEY]: DEFAULT_RULES });
  } else if ((existing.version || 0) < RULES_VERSION) {
    // 规则结构升级：保留用户自定义，补齐缺失字段
    const merged = { ...DEFAULT_RULES, ...existing, version: RULES_VERSION };
    await chrome.storage.local.set({ [RULES_KEY]: merged });
  }

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
  }
});

// 首次运行也确保规则存在（覆盖「已安装但规则被清空」的情况）
chrome.runtime.onStartup.addListener(async () => {
  const r = await chrome.storage.local.get(RULES_KEY);
  if (!r[RULES_KEY]) {
    await chrome.storage.local.set({ [RULES_KEY]: DEFAULT_RULES });
  }
});
