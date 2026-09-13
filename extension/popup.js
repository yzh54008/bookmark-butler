import {
  getAllBookmarks, loadMeta, faviconFor, escapeHtml, highlight,
  normalizeUrl, computeStats
} from './shared.js';
import { classify, DEFAULT_RULES } from './rules.js';
import { loadRules } from './shared.js';

let ALL = [];
let META = {};
let RULES = DEFAULT_RULES;
let VIEW = [];
let selIdx = 0;
let filter = 'all';

const $ = (s) => document.querySelector(s);
const listEl = $('#list');
const qEl = $('#q');

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), ms);
}

/* ---------------- 搜索评分 ---------------- */
function score(bm, tokens) {
  const title = (bm.title || '').toLowerCase();
  const url = (bm.url || '').toLowerCase();
  const host = (bm.host || '').toLowerCase();
  const path = bm.path.join(' ').toLowerCase();
  const m = META[bm.normalized] || {};
  const tags = (m.tags || []).join(' ').toLowerCase();
  const note = (m.note || '').toLowerCase();

  let total = 0;
  for (const tk of tokens) {
    let best = 0;
    if (title.startsWith(tk)) best = 120;
    else if (title.includes(tk)) best = 80;
    if (tags.includes(tk)) best = Math.max(best, 90);
    if (note.includes(tk)) best = Math.max(best, 55);
    if (host.includes(tk)) best = Math.max(best, 50);
    if (url.includes(tk)) best = Math.max(best, 35);
    if (path.includes(tk)) best = Math.max(best, 25);
    if (best === 0) return -1; // 有一个词没命中就淘汰（AND 语义）
    total += best;
  }
  return total;
}

function passesFilter(bm) {
  const m = META[bm.normalized] || {};
  if (filter === 'note') return !!(m.note || (m.tags || []).length);
  if (filter === 'blank') return !bm.title;
  if (filter === 'dup') {
    return ALL.filter((x) => x.normalized === bm.normalized).length > 1;
  }
  return true;
}

function search() {
  const q = qEl.value.trim();
  $('#clearQ').hidden = !q;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);

  let rows = ALL.filter(passesFilter);

  if (tokens.length) {
    rows = rows
      .map((b) => ({ b, s: score(b, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.b.title || '').localeCompare(b.b.title || ''))
      .map((x) => x.b);
  } else {
    rows = rows.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }

  VIEW = rows.slice(0, 300);
  selIdx = 0;
  render();
}

/* ---------------- 渲染 ---------------- */
function render() {
  if (!VIEW.length) {
    listEl.innerHTML = `<div class="empty">没有匹配的收藏<br><span style="font-size:11px">试试只输入一个关键词，或切换上方筛选</span></div>`;
    return;
  }
  const q = qEl.value.trim();
  listEl.innerHTML = VIEW.map((bm, i) => {
    const m = META[bm.normalized] || {};
    const fav = faviconFor(bm.url, 32);
    const letter = (bm.host || '?')[0].toUpperCase();
    const tags = [
      ...(m.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`),
      m.note ? `<span class="tag note">${escapeHtml(m.note.slice(0, 40))}</span>` : '',
    ].join('');
    const dupCount = ALL.filter((x) => x.normalized === bm.normalized).length;
    return `
      <div class="row ${i === selIdx ? 'sel' : ''}" data-i="${i}" data-url="${escapeHtml(bm.url)}">
        ${fav
          ? `<img class="fav" src="${fav}" onerror="this.outerHTML='<div class=\\'fav-fb\\'>${letter}</div>'">`
          : `<div class="fav-fb">${letter}</div>`}
        <div class="row-main">
          <div class="row-t">${bm.title ? highlight(bm.title, q.split(/\s+/)[0] || '') : '<i style="color:#8b95a3">(无标题)</i>'}</div>
          <div class="row-m">
            ${escapeHtml(bm.host)}${dupCount > 1 ? ` <span style="color:#a32d2d">· 重复 ${dupCount} 份</span>` : ''}
            <br><span class="path">${escapeHtml(bm.path.join(' / '))}</span>
          </div>
          ${tags ? `<div class="tags">${tags}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.row').forEach((el) => {
    el.addEventListener('click', (e) => {
      const url = el.dataset.url;
      if (e.ctrlKey || e.metaKey) chrome.tabs.update({ url });
      else chrome.tabs.create({ url });
      window.close();
    });
    el.addEventListener('mouseenter', () => {
      selIdx = +el.dataset.i;
      listEl.querySelectorAll('.row').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
    });
  });
}

function scrollToSel() {
  const el = listEl.querySelector('.row.sel');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

/* ---------------- 一键整理 ---------------- */
async function quickTidy() {
  const rules = RULES;
  const plan = ALL.filter((bm) => {
    const target = classify(bm, rules);
    const current = bm.path.slice(1).join('/');
    return target.join('/') !== current;
  });

  const byTarget = {};
  for (const bm of plan) {
    const k = classify(bm, rules).join(' / ');
    byTarget[k] = (byTarget[k] || 0) + 1;
  }
  const summary = Object.entries(byTarget)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `  ${k}  ←  ${v} 条`)
    .join('\n');

  if (!plan.length) { toast('已经整理好了，没有需要移动的书签'); return; }
  if (!confirm(`将移动 ${plan.length} 条书签到业务文件夹：\n\n${summary}\n${Object.keys(byTarget).length > 6 ? '  …\n' : ''}\n继续？`)) return;

  toast('整理中…', 60000);
  const { moveBookmarks } = await import('./tidy.js');
  const res = await moveBookmarks(plan, rules);
  toast(`完成：移动 ${res.moved} 条，新建文件夹 ${res.created} 个`);
  await refresh();
}

/* ---------------- 初始化 ---------------- */
async function refresh() {
  ALL = await getAllBookmarks();
  META = await loadMeta();
  RULES = await loadRules(DEFAULT_RULES);
  const st = computeStats(ALL, META);
  $('#hdStat').textContent =
    `${st.total} 条 · 唯一 ${st.unique} · 重复 ${st.dupItems} · 待整理 ${st.byTop.get('99 · 待整理') || 0}`;
  search();
}

qEl.addEventListener('input', search);

qEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selIdx = Math.min(selIdx + 1, VIEW.length - 1);
    render(); scrollToSel();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selIdx = Math.max(selIdx - 1, 0);
    render(); scrollToSel();
  } else if (e.key === 'Enter') {
    const bm = VIEW[selIdx];
    if (!bm) return;
    if (e.ctrlKey || e.metaKey) chrome.tabs.update({ url: bm.url });
    else chrome.tabs.create({ url: bm.url });
    window.close();
  } else if (e.key === 'Escape') {
    qEl.value = '';
    search();
  }
});

$('#clearQ').addEventListener('click', () => { qEl.value = ''; search(); qEl.focus(); });

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
  search();
});

$('#openManager').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$('#openAI').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('ai.html') });
  window.close();
});

$('#quickTidy').addEventListener('click', quickTidy);

refresh().then(() => qEl.focus());
