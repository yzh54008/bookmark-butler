/**
 * ai/apply.js — 执行 AI 方案（含完整操作日志，支持一键撤销）
 *
 * 原则：
 *  - 只移动，不删除任何书签。AI 再怎么错，也不会丢数据。
 *  - 每一步都记日志（原父目录 → 新父目录、新建了哪些文件夹），可原样回退。
 */
import { getBarId, resolveFolder, primeCache } from '../tidy.js';

const JOURNAL_KEY = 'ai_last_journal';

/**
 * 执行整理计划。
 * @param {Array<{bookmark:{id:string,title:string}, target:string[], needsMove:boolean}>} plan
 * @param {(done:number,total:number,label:string)=>void} [onProgress]
 */
export async function applyPlan(plan, onProgress) {
  const todo = plan.filter((p) => p.needsMove);
  await primeCache();
  const barId = await getBarId();
  const existing = new Set();
  (await collectFolderIds()).forEach((id) => existing.add(id));

  const moves = [];
  const createdFolders = [];
  const failed = [];
  let done = 0;

  for (const item of todo) {
    const bmId = item.bookmark.id;
    try {
      const cur = await chrome.bookmarks.get(bmId);
      const before = cur && cur[0] ? cur[0].parentId : null;
      const targetId = await resolveFolder(item.target);
      if (before === targetId) { done++; onProgress?.(done, todo.length, item.bookmark.title); continue; }
      await chrome.bookmarks.move(bmId, { parentId: targetId });
      moves.push({
        id: bmId,
        title: item.bookmark.title,
        from: before,
        to: targetId,
        fromPath: item.currentPath,
        toPath: item.target,
      });
    } catch (e) {
      failed.push({ id: bmId, title: item.bookmark.title, error: String(e) });
    }
    done++;
    onProgress?.(done, todo.length, item.bookmark.title);
  }

  // 记录本次执行新建的文件夹（撤销时若为空则清掉）
  const after = await collectFolderIds();
  for (const id of after) {
    if (!existing.has(id) && id !== barId) createdFolders.push(id);
  }

  const journal = {
    at: Date.now(),
    barId,
    moves,
    createdFolders,
    failed,
    total: todo.length,
  };
  await chrome.storage.local.set({ [JOURNAL_KEY]: journal });
  return { moved: moves.length, created: createdFolders.length, failed, journal };
}

async function collectFolderIds() {
  const tree = await chrome.bookmarks.getTree();
  const ids = [];
  (function walk(n) {
    for (const c of n.children || []) {
      if (!c.url) { ids.push(c.id); walk(c); }
    }
  })(tree[0]);
  return ids;
}

export async function loadJournal() {
  const r = await chrome.storage.local.get(JOURNAL_KEY);
  return r[JOURNAL_KEY] || null;
}

export async function clearJournal() {
  await chrome.storage.local.remove(JOURNAL_KEY);
}

/**
 * 撤销上一次整理：把书签移回原目录，再清理本次新建的空文件夹。
 * 逆序执行，避免嵌套目录先被删掉。
 */
export async function undoApply(journal, onProgress) {
  if (!journal || !journal.moves) throw new Error('没有可撤销的记录');
  const restored = [];
  const failed = [];

  for (let i = journal.moves.length - 1; i >= 0; i--) {
    const m = journal.moves[i];
    try {
      // 原父目录可能已被删除，先确认它还在
      const p = await chrome.bookmarks.get(m.from).catch(() => null);
      if (!p || !p[0]) {
        failed.push({ id: m.id, title: m.title, error: '原目录已不存在，无法归位' });
        continue;
      }
      await chrome.bookmarks.move(m.id, { parentId: m.from });
      restored.push(m.id);
    } catch (e) {
      failed.push({ id: m.id, title: m.title, error: String(e) });
    }
    onProgress?.(journal.moves.length - i, journal.moves.length, m.title);
  }

  // 清理本次新建的文件夹（逆序，只删空的）
  let removedFolders = 0;
  const folders = [...(journal.createdFolders || [])].reverse();
  for (const fid of folders) {
    try {
      const kids = await chrome.bookmarks.getChildren(fid);
      if (kids.length === 0) { await chrome.bookmarks.remove(fid); removedFolders++; }
    } catch { /* 已被删或不存在，忽略 */ }
  }

  await clearJournal();
  return { restored: restored.length, removedFolders, failed };
}

/** 撤销前预览：明确告诉用户会恢复多少条、清理多少目录 */
export function describeJournal(journal) {
  if (!journal) return null;
  const d = new Date(journal.at);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    at: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    moves: (journal.moves || []).length,
    createdFolders: (journal.createdFolders || []).length,
    failed: (journal.failed || []).length,
  };
}
