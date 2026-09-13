/**
 * shared.js — 公共工具：书签读取、URL 规范化、备注存储
 */

/** 规范化 URL，作为「标签/备注」的稳定主键（书签被删后重建也能保留） */
export function normalizeUrl(url) {
  if (!url) return '';
  let u = url.trim().replace(/\/+$/, '');
  u = u.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  u = u.replace(/[?&](utm_[^&]*|data_source=[^&]*|fromscene=[^&]*)$/i, '');
  return u.toLowerCase();
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function hostPortOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

export function isInternal(url) {
  const h = hostPortOf(url).split(':')[0];
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
  return false;
}

/** 剥掉零宽字符等格式控制字符 */
export function cleanTitle(name) {
  return (name || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 拉取整棵书签树，摊平成带路径的书签数组 */
export async function getAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const out = [];

  function walk(node, path, parentId) {
    for (const c of node.children || []) {
      if (c.url) {
        out.push({
          id: c.id,
          parentId: c.parentId ?? parentId,
          title: cleanTitle(c.title),
          rawTitle: c.title || '',
          url: c.url,
          path,
          dateAdded: c.dateAdded || 0,
          normalized: normalizeUrl(c.url),
          host: hostOf(c.url),
        });
      } else {
        walk(c, [...path, cleanTitle(c.title) || '(未命名)'], c.id);
      }
    }
  }

  const root = tree[0];
  for (const top of root.children || []) {
    walk(top, [cleanTitle(top.title) || '书签'], top.id);
  }
  return out;
}

/** 拉取文件夹树（仅文件夹） */
export async function getFolderTree() {
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  function walk(node, path) {
    for (const c of node.children || []) {
      if (!c.url) {
        const p = [...path, cleanTitle(c.title) || '(未命名)'];
        folders.push({ id: c.id, title: cleanTitle(c.title), path: p, parentId: c.parentId });
        walk(c, p);
      }
    }
  }
  const root = tree[0];
  for (const top of root.children || []) {
    folders.push({ id: top.id, title: cleanTitle(top.title), path: [cleanTitle(top.title)], parentId: '0', topLevel: true });
    walk(top, [cleanTitle(top.title)]);
  }
  return folders;
}

/** 按路径查找/创建文件夹，返回 folderId。path 形如 ['01 · OZON 运营','卖家后台'] */
export async function ensureFolder(path, cache) {
  const key = path.join('/');
  if (cache && cache.has(key)) return cache.get(key);

  let parentId = '1'; // 收藏夹栏
  const tree = await chrome.bookmarks.getTree();
  const bar = (tree[0].children || []).find(
    (c) => c.id === '1' || cleanTitle(c.title).includes('收藏夹栏') || cleanTitle(c.title).includes('书签栏')
  );
  if (bar) parentId = bar.id;

  let currentPath = [];
  for (const seg of path) {
    currentPath.push(seg);
    const ckey = currentPath.join('/');
    if (cache && cache.has(ckey)) {
      parentId = cache.get(ckey);
      continue;
    }
    const kids = await chrome.bookmarks.getChildren(parentId);
    let found = kids.find((k) => !k.url && cleanTitle(k.title) === seg);
    if (!found) {
      found = await chrome.bookmarks.create({ parentId, title: seg });
    }
    parentId = found.id;
    if (cache) cache.set(ckey, parentId);
  }
  return parentId;
}

/* ---------------- 备注与标签存储 ---------------- */

const META_KEY = 'bookmark_meta';

export async function loadMeta() {
  const r = await chrome.storage.local.get(META_KEY);
  return r[META_KEY] || {};
}

export async function saveMeta(meta) {
  await chrome.storage.local.set({ [META_KEY]: meta });
}

export async function setMetaFor(url, patch) {
  const meta = await loadMeta();
  const k = normalizeUrl(url);
  meta[k] = { ...(meta[k] || {}), ...patch };
  if (!meta[k].tags?.length && !meta[k].note) delete meta[k];
  await saveMeta(meta);
  return meta;
}

/* ---------------- 规则 ---------------- */

const RULES_KEY = 'classify_rules';

export async function loadRules(fallback) {
  const r = await chrome.storage.local.get(RULES_KEY);
  return r[RULES_KEY] || fallback;
}

export async function saveRules(rules) {
  await chrome.storage.local.set({ [RULES_KEY]: rules });
}

export async function resetRules(fallback) {
  await chrome.storage.local.remove(RULES_KEY);
  return fallback;
}

/* ---------------- 小工具 ---------------- */

export function faviconFor(url, size = 32) {
  try {
    return chrome.runtime.getURL(
      `_favicon/?pageUrl=${encodeURIComponent(url)}&size=${size}`
    );
  } catch {
    return '';
  }
}

export function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return safe;
  return (
    escapeHtml(text.slice(0, idx)) +
    '<mark>' +
    escapeHtml(text.slice(idx, idx + q.length)) +
    '</mark>' +
    escapeHtml(text.slice(idx + q.length))
  );
}

/** 收藏夹栏（书签栏）的根节点名 */
export const BAR_NAME_RE = /收藏夹栏|书签栏|Bookmarks\s*bar/i;
export function isBarRoot(name) {
  return BAR_NAME_RE.test(name || '');
}

/** 全库统计 */
export function computeStats(bookmarks, meta) {
  const byUrl = new Map();
  for (const b of bookmarks) {
    const arr = byUrl.get(b.normalized) || [];
    arr.push(b);
    byUrl.set(b.normalized, arr);
  }
  let dupGroups = 0;
  let dupItems = 0;
  for (const arr of byUrl.values()) {
    if (arr.length > 1) {
      dupGroups++;
      dupItems += arr.length - 1;
    }
  }
  const blank = bookmarks.filter((b) => !b.title).length;
  const tagged = bookmarks.filter((b) => {
    const m = meta[b.normalized];
    return m && (m.tags?.length || m.note);
  }).length;

  const byTop = new Map();
  for (const b of bookmarks) {
    const top = b.path[1] || '(根目录)';
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }
  // 直接平铺在「收藏夹栏」上的书签：path 只有根节点名一级，且根节点就是收藏夹栏
  const looseOnBar = bookmarks.filter(
    (b) => b.path.length === 1 && isBarRoot(b.path[0])
  ).length;

  return { total: bookmarks.length, dupGroups, dupItems, blank, tagged, byTop, looseOnBar, unique: byUrl.size };
}
