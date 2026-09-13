/**
 * tidy.js — 实际执行书签改动的模块（移动 / 查重合并 / 删除导入残留 / 修标题）
 * 所有操作直接调用 chrome.bookmarks API，失败会向上抛。
 */
import { cleanTitle, normalizeUrl } from './shared.js';

/* ---------------- 文件夹解析 ---------------- */

let _barId = null;
const _folderCache = new Map(); // pathKey -> folderId

export async function getBarId() {
  if (_barId) return _barId;
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  // 优先取 id === '1'（Chromium 固定的收藏夹栏 id）
  let bar = (root.children || []).find((c) => c.id === '1');
  if (!bar) {
    bar = (root.children || []).find((c) =>
      /收藏夹栏|书签栏|Bookmarks bar|Bookmarks Bar/i.test(cleanTitle(c.title))
    );
  }
  if (!bar) bar = (root.children || [])[0];
  _barId = bar.id;
  return _barId;
}

export function clearFolderCache() {
  _folderCache.clear();
}

/**
 * 按路径解析文件夹 id，不存在则创建。
 * @param {string[]} path 例：['01 · OZON 运营', '卖家后台']
 */
export async function resolveFolder(path) {
  const barId = await getBarId();
  let parentId = barId;
  const acc = [];
  for (const seg of path) {
    acc.push(seg);
    const key = acc.join('/');
    if (_folderCache.has(key)) {
      parentId = _folderCache.get(key);
      continue;
    }
    const kids = await chrome.bookmarks.getChildren(parentId);
    let found = kids.find((k) => !k.url && cleanTitle(k.title) === seg);
    if (!found) {
      found = await chrome.bookmarks.create({ parentId, title: seg });
    }
    parentId = found.id;
    _folderCache.set(key, parentId);
  }
  return parentId;
}

/** 预热缓存：一次性把现有文件夹灌进来，避免重复查询 */
export async function primeCache() {
  const tree = await chrome.bookmarks.getTree();
  const barId = await getBarId();
  _folderCache.clear();
  function walk(node, path) {
    for (const c of node.children || []) {
      if (c.url) continue;
      const p = path ? [...path, cleanTitle(c.title)] : [];
      if (p.length) _folderCache.set(p.join('/'), c.id);
      walk(c, p.length ? p : [cleanTitle(c.title)]);
    }
  }
  const root = tree[0];
  for (const top of root.children || []) {
    if (top.id === barId) {
      walk(top, []);
      if (top.title) _folderCache.set(cleanTitle(top.title), top.id);
    } else {
      const n = cleanTitle(top.title);
      _folderCache.set(n, top.id);
      walk(top, [n]);
    }
  }
}

/* ---------------- 移动 ---------------- */

/**
 * 按整理计划移动书签。
 * @param {Array<{bookmark:{id:string}, target:string[]}>} plan
 * @returns {{moved:number, created:number, failed:Array}}
 */
export async function moveBookmarks(plan, rules) {
  await primeCache();
  const before = new Set(_folderCache.keys());
  let moved = 0;
  const failed = [];

  for (const item of plan) {
    try {
      const parentId = await resolveFolder(item.target);
      const bmId = item.bookmark.id;
      const cur = await chrome.bookmarks.get(bmId);
      if (cur && cur[0] && cur[0].parentId === parentId) continue;
      await chrome.bookmarks.move(bmId, { parentId });
      moved++;
    } catch (e) {
      failed.push({ id: item.bookmark.id, title: item.bookmark.title, error: String(e) });
    }
  }

  const created = [..._folderCache.keys()].filter((k) => !before.has(k)).length;
  return { moved, created, failed };
}

/* ---------------- 查重 ---------------- */

/**
 * 找出重复的网址分组
 * @returns {Array<{normalized:string, items:Array, keepIdx:number}>}
 */
export function findDuplicates(bookmarks) {
  const map = new Map();
  for (const b of bookmarks) {
    if (!b.url) continue;
    const key = b.normalized || normalizeUrl(b.url);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }
  const groups = [];
  for (const [normalized, items] of map) {
    if (items.length < 2) continue;
    // 保留规则：路径最深（归过类）× 标题最完整 × 最早添加
    const sorted = [...items].sort((a, b) => {
      const pa = a.path.length, pb = b.path.length;
      if (pa !== pb) return pb - pa;
      const ta = cleanTitle(a.rawTitle || a.title).length;
      const tb = cleanTitle(b.rawTitle || b.title).length;
      if (ta !== tb) return tb - ta;
      return (a.dateAdded || 0) - (b.dateAdded || 0);
    });
    const keep = sorted[0];
    groups.push({
      normalized,
      items,
      keep,
      keepIdx: items.findIndex((x) => x.id === keep.id),
      removeCount: items.length - 1,
    });
  }
  return groups.sort((a, b) => b.removeCount - a.removeCount);
}

/**
 * 合并重复：每组保留一条（可指定），删除其余。
 * @param {Array} groups findDuplicates 的结果
 * @param {Object} keepMap { [normalized]: bookmarkId } 覆盖默认保留项
 */
export async function mergeDuplicates(groups, keepMap = {}) {
  let removed = 0;
  const failed = [];
  for (const g of groups) {
    const keepId = keepMap[g.normalized] || g.keep.id;
    for (const it of g.items) {
      if (it.id === keepId) continue;
      try {
        await chrome.bookmarks.remove(it.id);
        removed++;
      } catch (e) {
        failed.push({ id: it.id, title: it.title, error: String(e) });
      }
    }
  }
  return { removed, failed };
}

/* ---------------- 导入残留文件夹 ---------------- */

/** 找出「从 X 导入」这类残留文件夹（含嵌套） */
export async function findImportFolders() {
  const tree = await chrome.bookmarks.getTree();
  const found = [];
  function walk(node, path) {
    for (const c of node.children || []) {
      if (c.url) continue;
      const title = cleanTitle(c.title);
      const p = [...path, title];
      if (/^(从|From)\s*.{0,30}(导入|Import)/i.test(title) || /导入\s*\(\d+\)$/.test(title)) {
        found.push({ id: c.id, title, path: p });
      }
      walk(c, p);
    }
  }
  const root = tree[0];
  for (const top of root.children || []) {
    walk(top, [cleanTitle(top.title)]);
  }
  return found;
}

/** 删除指定的文件夹树 */
export async function removeFolders(ids) {
  let n = 0;
  const failed = [];
  for (const id of ids) {
    try {
      await chrome.bookmarks.removeTree(id);
      n++;
    } catch (e) {
      failed.push({ id, error: String(e) });
    }
  }
  return { removed: n, failed };
}

/* ---------------- 标题修复 ---------------- */

function fallbackTitle(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '');
    const segs = u.pathname.split('/').filter(Boolean);
    const tail = segs.length ? segs[segs.length - 1].slice(0, 24) : '';
    return tail ? `${host} / ${tail}` : host;
  } catch {
    return (url || '').slice(0, 40) || '(无标题)';
  }
}

/** 找出标题为空或仅含零宽字符的书签 */
export function findBlankTitles(bookmarks) {
  return bookmarks.filter((b) => !cleanTitle(b.rawTitle || b.title));
}

/** 批量修复空白标题 */
export async function fixBlankTitles(items) {
  let fixed = 0;
  const failed = [];
  for (const it of items) {
    const title = fallbackTitle(it.url);
    try {
      await chrome.bookmarks.update(it.id, { title });
      fixed++;
    } catch (e) {
      failed.push({ id: it.id, error: String(e) });
    }
  }
  return { fixed, failed };
}

/* ---------------- 失效链接检测（可选，较慢） ---------------- */

/**
 * 用 fetch + HEAD 探测链接是否可达。受 CORS 限制，结果仅供参考。
 * 只对 http/https 生效，失败一律记为 unknown 而不是「失效」。
 */
export async function checkLinks(bookmarks, concurrency = 6, onProgress) {
  const httpOnes = bookmarks.filter((b) => /^https?:/i.test(b.url));
  const results = [];
  let i = 0;
  async function worker() {
    while (i < httpOnes.length) {
      const b = httpOnes[i++];
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 9000);
        const r = await fetch(b.url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
        clearTimeout(timer);
        results.push({ bookmark: b, status: r.status, ok: r.status < 400 });
      } catch {
        results.push({ bookmark: b, status: 0, ok: null });
      }
      if (onProgress) onProgress(results.length, httpOnes.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, httpOnes.length) }, worker));
  return results;
}
