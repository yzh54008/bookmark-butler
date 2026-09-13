import {
  getAllBookmarks, loadMeta, saveMeta, loadRules, saveRules, resetRules,
  faviconFor, escapeHtml, computeStats, cleanTitle, normalizeUrl, isBarRoot
} from './shared.js';
import { DEFAULT_RULES, classify, validateRules, UNCLASSIFIED } from './rules.js';
import {
  moveBookmarks, findDuplicates, mergeDuplicates, findImportFolders,
  removeFolders, findBlankTitles, fixBlankTitles, clearFolderCache
} from './tidy.js';

let ALL = [];
let META = {};
let RULES = DEFAULT_RULES;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------------- 通用 ---------------- */
function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), ms);
}
function busy(on, text = '处理中…') {
  const m = $('#mask');
  m.querySelector('.spin').textContent = text;
  m.hidden = !on;
}
function favHtml(url) {
  const src = faviconFor(url, 32);
  const letter = (() => { try { return new URL(url).hostname.replace(/^www\./, '')[0].toUpperCase(); } catch { return '?'; } })();
  if (!src) {
    return `<div class="fav" style="display:flex;align-items:center;justify-content:center;background:#e1f5ee;color:#0f6e56;font-size:9px;border-radius:3px">${escapeHtml(letter)}</div>`;
  }
  return `<img class="fav" src="${src}" data-letter="${escapeHtml(letter)}" onerror="window.__favfb&&window.__favfb(this)">`;
}
window.__favfb = (img) => {
  const d = document.createElement('div');
  d.className = 'fav';
  d.style.cssText = 'display:flex;align-items:center;justify-content:center;background:#e1f5ee;color:#0f6e56;font-size:9px;border-radius:3px';
  d.textContent = img.dataset.letter || '?';
  img.replaceWith(d);
};

/* ---------------- 载入 ---------------- */
async function scan() {
  busy(true, '正在扫描收藏夹…');
  ALL = await getAllBookmarks();
  META = await loadMeta();
  RULES = await loadRules(DEFAULT_RULES);
  clearFolderCache();
  renderOverview();
  renderTidy();
  renderDedupe();
  renderNotes();
  const st = computeStats(ALL, META);
  $('#subStat').textContent =
    `共 ${st.total} 条 · 唯一网址 ${st.unique} · 重复冗余 ${st.dupItems} 条 · 收藏栏散落 ${st.looseOnBar} 条 · 有备注 ${st.tagged} 条`;
  busy(false);
}

/* ---------------- Tab ---------------- */
$('#btnAI')?.addEventListener('click', () => {
  if (window.__DEMO__) {
    // 预览模式下 openOptionsPage 不存在，直接跳转到 ai.html
    location.href = 'ai.html';
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('ai.html') });
});

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + b.dataset.tab));
  if (b.dataset.tab === 'rules') $('#ruleJson').value = JSON.stringify(RULES, null, 2);
});

/* ---------------- 概览 ---------------- */
function renderOverview() {
  const st = computeStats(ALL, META);
  const unclassified = st.byTop.get('99 · 待整理') || 0;
  const cards = [
    { k: '书签总数', v: st.total, cls: '' },
    { k: '唯一网址', v: st.unique, cls: 'good' },
    { k: '重复冗余条目', v: st.dupItems, cls: st.dupItems ? 'bad' : 'good', u: '条可清理' },
    { k: '收藏栏顶层散落', v: st.looseOnBar, cls: st.looseOnBar > 20 ? 'warn' : '' },
    { k: '空白标题', v: st.blank, cls: st.blank ? 'warn' : 'good' },
    { k: '未归类', v: unclassified, cls: unclassified ? 'warn' : 'good' },
    { k: '已有备注/标签', v: st.tagged, cls: 'good' },
    { k: '不同域名', v: new Set(ALL.map((b) => b.host)).size, cls: '' },
  ];
  $('#cards').innerHTML = cards.map((c) => `
    <div class="card ${c.cls}">
      <div class="k">${c.k}</div>
      <div class="v">${c.v}<span class="u">${c.u || ''}</span></div>
    </div>`).join('');

  const entries = [...st.byTop.entries()]
    .filter(([k]) => !/^(收藏夹栏|书签栏|其他收藏夹|移动收藏夹)$/.test(k))
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));

  const sub = {};
  for (const b of ALL) {
    const t = b.path[1] || '(根目录)';
    const s = b.path[2];
    if (!s) continue;
    (sub[t] = sub[t] || {});
    sub[t][s] = (sub[t][s] || 0) + 1;
  }

  let html = entries.map(([k, v]) => `
    <div class="srow">
      <span class="sname">${escapeHtml(k)}</span>
      <span class="sbar"><i style="width:${Math.round((v / max) * 100)}%"></i></span>
      <span class="scount">${v} 条</span>
    </div>`).join('');

  for (const [t, subs] of Object.entries(sub)) {
    if (!entries.find(([k]) => k === t)) continue;
    html += Object.entries(subs).sort((a, b) => b[1] - a[1]).map(([s, n]) => `
      <div class="srow sub">
        <span class="sname">${escapeHtml(s)}</span>
        <span class="sbar"><i style="width:${Math.round((n / max) * 100)}%;background:#5dcaa5"></i></span>
        <span class="scount">${n} 条</span>
      </div>`).join('');
  }

  const barLoose = ALL.filter((b) => b.path.length === 1 && isBarRoot(b.path[0]));
  if (barLoose.length) {
    html = `<div class="srow">
      <span class="sname" style="color:#a32d2d">⚠ 直接平铺在收藏栏上的散书签</span>
      <span class="sbar"><i style="width:100%;background:#e24b4a"></i></span>
      <span class="scount">${barLoose.length} 条</span>
    </div>` + html;
  }

  $('#struct').innerHTML = html || '<div class="empty">暂无数据</div>';
  renderFixPanel(st);
}

/* ---------------- 一键修复 ---------------- */
async function renderFixPanel(st) {
  const panel = $('#fixPanel');
  panel.innerHTML = '<div class="empty">正在检测…</div>';

  const [imports, blanks] = await Promise.all([
    findImportFolders(),
    Promise.resolve(findBlankTitles(ALL)),
  ]);

  const rows = [];

  rows.push(`
    <div class="srow">
      <span class="sname">
        <b>「从…导入」残留文件夹</b>
        <div style="font-size:11px;color:#8b95a3;margin-top:2px">
          浏览器重复导入时留下的整树副本，是重复书签的主要来源
        </div>
      </span>
      <span class="scount" style="min-width:70px;text-align:right">${imports.length} 个</span>
      <button class="btn ${imports.length ? 'btn-danger' : ''}" id="btnFixImport" ${imports.length ? '' : 'disabled'}>
        ${imports.length ? '删除全部' : '无'}
      </button>
    </div>`);

  rows.push(`
    <div class="srow">
      <span class="sname">
        <b>空白标题书签</b>
        <div style="font-size:11px;color:#8b95a3;margin-top:2px">
          标题里只有零宽字符，浏览器里显示为空——按「域名 / 路径」自动补名
        </div>
      </span>
      <span class="scount" style="min-width:70px;text-align:right">${blanks.length} 条</span>
      <button class="btn ${blanks.length ? 'btn-primary' : ''}" id="btnFixBlank" ${blanks.length ? '' : 'disabled'}>
        ${blanks.length ? '修复标题' : '无'}
      </button>
    </div>`);

  rows.push(`
    <div class="srow">
      <span class="sname">
        <b>重复书签</b>
        <div style="font-size:11px;color:#8b95a3;margin-top:2px">
          同一网址存了多份，去「重复清理」页逐组确认或一键合并
        </div>
      </span>
      <span class="scount" style="min-width:70px;text-align:right">${st.dupItems} 条冗余</span>
      <button class="btn" id="btnGoDup" ${st.dupItems ? '' : 'disabled'}>去处理</button>
    </div>`);

  rows.push(`
    <div class="srow">
      <span class="sname">
        <b>未归类书签</b>
        <div style="font-size:11px;color:#8b95a3;margin-top:2px">
          域名不在规则表里，去「智能整理」执行后会进「99 · 待整理」
        </div>
      </span>
      <span class="scount" style="min-width:70px;text-align:right">${st.byTop.get('99 · 待整理') || 0} 条</span>
      <button class="btn" id="btnGoRule">改规则</button>
    </div>`);

  panel.innerHTML = rows.join('');

  $('#btnFixImport').addEventListener('click', async () => {
    if (!confirm(`删除 ${imports.length} 个「从…导入」文件夹？\n\n这会连同里面的书签一起删除。建议先在「重复清理」里确认这些书签在主目录都有副本。`)) return;
    busy(true, '正在删除导入残留…');
    try {
      const res = await removeFolders(imports.map((f) => f.id));
      await scan();
      toast(`已删除 ${res.removed} 个残留文件夹${res.failed.length ? `，失败 ${res.failed.length} 个` : ''}`);
    } catch (e) { toast('删除失败：' + escapeHtml(String(e))); }
    finally { busy(false); }
  });

  $('#btnFixBlank').addEventListener('click', async () => {
    if (!confirm(`为 ${blanks.length} 条无标题书签自动生成可读标题？`)) return;
    busy(true, '正在修复标题…');
    try {
      const res = await fixBlankTitles(blanks);
      await scan();
      toast(`已修复 ${res.fixed} 条标题`);
    } catch (e) { toast('修复失败：' + escapeHtml(String(e))); }
    finally { busy(false); }
  });

  $('#btnGoDup').addEventListener('click', () => $('.tab[data-tab="dedupe"]').click());
  $('#btnGoRule').addEventListener('click', () => $('.tab[data-tab="rules"]').click());
}

/* ---------------- 智能整理 ---------------- */
let TIDY_PLAN = [];

function buildPlan() {
  const onlyBar = $('#onlyBar').checked;
  const plan = [];
  for (const bm of ALL) {
    const target = classify(bm, RULES);
    const current = bm.path.slice(1);
    if (target.join('/') === current.join('/')) continue;
    if (onlyBar && bm.path.length !== 1) continue;
    plan.push({ bookmark: bm, target, currentPath: current });
  }
  return plan;
}

function renderTidy() {
  TIDY_PLAN = buildPlan();
  const byTarget = {};
  for (const p of TIDY_PLAN) {
    const k = p.target.join(' / ');
    byTarget[k] = (byTarget[k] || 0) + 1;
  }
  const un = byTarget[UNCLASSIFIED.join(' / ')] || 0;

  $('#tidyInfo').innerHTML = TIDY_PLAN.length
    ? `将移动 <b>${TIDY_PLAN.length}</b> 条书签到 <b>${Object.keys(byTarget).length}</b> 个目标文件夹` +
      (un ? ` <span style="color:#854f0b">（其中 ${un} 条域名未收录，会进「99 · 待整理」）</span>` : '')
    : '所有书签都已在正确位置，无需整理';

  $('#btnTidyExec').disabled = !TIDY_PLAN.length;

  const shown = TIDY_PLAN.slice(0, 400);
  $('#tidyList').innerHTML = shown.length
    ? shown.map((p) => `
      <div class="item">
        ${favHtml(p.bookmark.url)}
        <div class="main">
          <div class="t">${escapeHtml(p.bookmark.title || '(无标题)')}</div>
          <div class="m">${escapeHtml(p.bookmark.host)} · 当前位置：${escapeHtml(p.currentPath.join(' / ') || '(根)')}</div>
        </div>
        <div class="arrow">→ <span class="to">${escapeHtml(p.target.join(' / '))}</span></div>
      </div>`).join('') + (TIDY_PLAN.length > 400
        ? `<div class="empty">仅预览前 400 条，实际会处理全部 ${TIDY_PLAN.length} 条</div>` : '')
    : '<div class="empty">没有需要移动的书签</div>';
}

$('#onlyBar').addEventListener('change', renderTidy);

$('#btnTidyExec').addEventListener('click', async () => {
  if (!TIDY_PLAN.length) return;
  if (!confirm(`确认移动 ${TIDY_PLAN.length} 条书签？\n\n此操作只做移动，不删除任何书签。`)) return;
  busy(true, `正在移动 ${TIDY_PLAN.length} 条书签…`);
  try {
    const res = await moveBookmarks(TIDY_PLAN, RULES);
    let msg = `已移动 ${res.moved} 条，新建文件夹 ${res.created} 个`;
    if (res.failed.length) msg += `，失败 ${res.failed.length} 条`;
    if (res.failed.length) console.warn('移动失败：', res.failed);
    await scan();
    toast(msg);
  } catch (e) {
    toast('整理失败：' + escapeHtml(String(e)));
  } finally {
    busy(false);
  }
});

/* ---------------- 重复清理 ---------------- */
let DUP_GROUPS = [];
const KEEP_CHOICE = new Map(); // normalized -> bookmarkId
const DUP_SELECTED = new Set(); // normalized

function renderDedupe() {
  DUP_GROUPS = findDuplicates(ALL);
  const totalRemovable = DUP_GROUPS.reduce((s, g) => s + g.removeCount, 0);

  $('#dupInfo').innerHTML = DUP_GROUPS.length
    ? `发现 <b>${DUP_GROUPS.length}</b> 组重复网址，共 <b style="color:#a32d2d">${totalRemovable}</b> 条冗余`
    : '没有发现重复书签';

  $('#btnDupExec').disabled = !DUP_SELECTED.size;
  $('#btnDupExec').textContent = DUP_SELECTED.size
    ? `合并所选（${DUP_SELECTED.size} 组）` : '合并所选';

  if (!DUP_GROUPS.length) {
    $('#dupList').innerHTML = '<div class="empty">没有重复书签 👍</div>';
    return;
  }

  const shown = DUP_GROUPS.slice(0, 300);
  $('#dupList').innerHTML = shown.map((g) => {
    const keepId = KEEP_CHOICE.get(g.normalized) || g.keep.id;
    const checked = DUP_SELECTED.has(g.normalized) ? 'checked' : '';
    return `
    <div class="group" data-key="${escapeHtml(g.normalized)}">
      <div class="ghead">
        <input type="checkbox" class="gsel" data-key="${escapeHtml(g.normalized)}" ${checked}>
        <span>同一网址 ${g.items.length} 份 · 将删除 <b>${g.items.length - 1}</b> 条</span>
        <span style="flex:1"></span>
        <span style="font-size:11px">${escapeHtml(g.items[0].host)}</span>
      </div>
      <div class="gbody">
        ${g.items.map((it) => `
          <div class="item ${it.id === keepId ? 'keep' : ''}">
            <input type="radio" class="radio" name="k_${escapeHtml(g.normalized)}"
                   data-key="${escapeHtml(g.normalized)}" data-id="${it.id}" ${it.id === keepId ? 'checked' : ''}>
            ${favHtml(it.url)}
            <div class="main">
              <div class="t">${escapeHtml(it.title || '(无标题)')}</div>
              <div class="m">${escapeHtml(it.path.join(' / '))}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('') + (DUP_GROUPS.length > 300
    ? `<div class="empty">仅显示前 300 组，实际共 ${DUP_GROUPS.length} 组</div>` : '');

  // 事件
  $('#dupList').querySelectorAll('.gsel').forEach((el) => {
    el.addEventListener('change', () => {
      const k = el.dataset.key;
      if (el.checked) DUP_SELECTED.add(k); else DUP_SELECTED.delete(k);
      $('#btnDupExec').disabled = !DUP_SELECTED.size;
      $('#btnDupExec').textContent = DUP_SELECTED.size
        ? `合并所选（${DUP_SELECTED.size} 组）` : '合并所选';
    });
  });
  $('#dupList').querySelectorAll('.radio').forEach((el) => {
    el.addEventListener('change', () => {
      KEEP_CHOICE.set(el.dataset.key, el.dataset.id);
      const grp = el.closest('.group');
      grp.querySelectorAll('.item').forEach((it) => it.classList.remove('keep'));
      el.closest('.item').classList.add('keep');
    });
  });
}

/* ---------------- 合并执行 ---------------- */

$('#btnDupExec').addEventListener('click', async () => {
  const groups = DUP_GROUPS.filter((g) => DUP_SELECTED.has(g.normalized));
  const n = groups.reduce((s, g) => s + g.items.length - 1, 0);
  if (!groups.length || !confirm(`确认删除 ${n} 条重复书签？\n\n每组保留你指定的那一条，删除其余。`)) return;
  busy(true, `正在合并 ${groups.length} 组…`);
  try {
    const res = await mergeDuplicates(groups, Object.fromEntries(KEEP_CHOICE));
    DUP_SELECTED.clear();
    KEEP_CHOICE.clear();
    await scan();
    toast(`已删除 ${res.removed} 条重复书签${res.failed.length ? `，失败 ${res.failed.length} 条` : ''}`);
  } catch (e) {
    toast('合并失败：' + escapeHtml(String(e)));
  } finally {
    busy(false);
  }
});

/* ---------------- 标签备注 ---------------- */
function visibleNotes() {
  const q = ($('#noteSearch').value || '').trim().toLowerCase();
  const rows = ALL.map((b) => {
    const m = META[b.normalized] || {};
    return { b, m, has: !!(m.note || (m.tags || []).length) };
  }).filter(({ b, m, has }) => {
    if (!q) return true;
    return (b.title || '').toLowerCase().includes(q) ||
      (b.url || '').toLowerCase().includes(q) ||
      (m.note || '').toLowerCase().includes(q) ||
      (m.tags || []).join(' ').toLowerCase().includes(q);
  });
  rows.sort((a, b) => (b.has - a.has) || (a.b.title || '').localeCompare(b.b.title || ''));
  return rows;
}

function renderNotes() {
  const rows = visibleNotes();
  const withMeta = rows.filter((r) => r.has).length;
  $('#noteInfo').innerHTML = `共 ${ALL.length} 条，其中 <b>${withMeta}</b> 条已有备注或标签 · 显示 ${Math.min(rows.length, 200)} 条`;

  $('#noteList').innerHTML = rows.slice(0, 200).map(({ b, m }) => {
    const tags = (m.tags || []).join(', ');
    return `
    <div class="item" data-url="${escapeHtml(b.url)}" data-key="${escapeHtml(b.normalized)}">
      ${favHtml(b.url)}
      <div class="main">
        <div class="t">${escapeHtml(b.title || '(无标题)')}</div>
        <div class="m">${escapeHtml(b.host)} · ${escapeHtml(b.path.join(' / '))}</div>
        <div class="note-row">
          <input class="tag-input nt" placeholder="备注（这个站是干什么用的）" value="${escapeHtml(m.note || '')}">
          <input class="tag-input tg" placeholder="标签，逗号分隔" value="${escapeHtml(tags)}">
        </div>
      </div>
    </div>`;
  }).join('') || '<div class="empty">没有匹配的书签</div>';

  $('#noteList').querySelectorAll('.item').forEach((el) => {
    const key = el.dataset.key;
    const save = async () => {
      const note = el.querySelector('.nt').value.trim();
      const tags = el.querySelector('.tg').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      const meta = await loadMeta();
      meta[key] = { ...(meta[key] || {}), note, tags };
      if (!note && !tags.length) delete meta[key];
      await saveMeta(meta);
      META = meta;
      $('#noteInfo').innerHTML = `共 ${ALL.length} 条，其中 <b>${Object.keys(meta).length}</b> 条已有备注或标签`;
    };
    el.querySelector('.nt').addEventListener('blur', save);
    el.querySelector('.tg').addEventListener('blur', save);
  });
}

let noteTimer = null;
$('#noteSearch').addEventListener('input', () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(renderNotes, 200);
});

/* ---------------- 规则 ---------------- */
$('#btnRuleSave').addEventListener('click', async () => {
  const msg = $('#ruleMsg');
  try {
    const obj = JSON.parse($('#ruleJson').value);
    const problems = validateRules(obj);
    if (problems.length) {
      msg.className = 'msg err';
      msg.innerHTML = '规则有问题，未保存：<br>' + problems.slice(0, 8).map(escapeHtml).join('<br>');
      msg.hidden = false;
      return;
    }
    await saveRules(obj);
    RULES = obj;
    RULES = await loadRules(DEFAULT_RULES);
    msg.className = 'msg ok';
    msg.textContent = '规则已保存，正在重新计算整理方案…';
    msg.hidden = false;
    renderTidy();
    renderOverview();
    setTimeout(() => (msg.hidden = true), 2500);
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'JSON 解析失败：' + String(e.message || e);
    msg.hidden = false;
  }
});

$('#btnRuleTest').addEventListener('click', () => {
  const msg = $('#ruleMsg');
  try {
    const obj = JSON.parse($('#ruleJson').value);
    const problems = validateRules(obj);
    if (problems.length) {
      msg.className = 'msg err';
      msg.innerHTML = '规则有问题：<br>' + problems.slice(0, 8).map(escapeHtml).join('<br>');
      msg.hidden = false;
      return;
    }
    const hits = {};
    let un = 0;
    for (const b of ALL) {
      const t = classify(b, obj).join(' / ');
      if (t === UNCLASSIFIED.join(' / ')) un++;
      hits[t] = (hits[t] || 0) + 1;
    }
    const lines = Object.entries(hits).sort((a, b) => b[1] - a[1]).slice(0, 16)
      .map(([k, v]) => `　${k} ← ${v} 条`).join('<br>');
    msg.className = 'msg ok';
    msg.innerHTML = `试算结果（共 ${ALL.length} 条，未归类 ${un} 条）：<br>${lines}`;
    msg.hidden = false;
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'JSON 解析失败：' + String(e.message || e);
    msg.hidden = false;
  }
});

$('#btnRuleReset').addEventListener('click', async () => {
  if (!confirm('恢复为默认规则？你自定义的规则会丢失。')) return;
  RULES = await resetRules(DEFAULT_RULES);
  RULES = await loadRules(DEFAULT_RULES);
  $('#ruleJson').value = JSON.stringify(RULES, null, 2);
  renderTidy();
  renderOverview();
  toast('已恢复默认规则');
});

$('#btnRefresh').addEventListener('click', scan);

/* ---------------- 启动 ---------------- */
scan();
