/**
 * ai.js — AI 整理台控制器
 *
 * 负责：模型配置界面、四步向导、进度与取消、方案预览与执行、撤销。
 * 真正的「智能」在 ai/planner.js 与 ai/prompts.js 里，这里只做编排与呈现。
 */
import { getAllBookmarks, escapeHtml, isBarRoot } from './shared.js';
import { DEFAULT_RULES } from './rules.js';
import {
  PROVIDERS, DEFAULT_PROVIDER, getProvider, validateBaseUrl, ensureOriginPermission,
} from './ai/provider.js';
import {
  loadConfig, saveConfig, resolveEndpoint, maskKey, isConfigured, pushHistory, clearKey,
} from './ai/store.js';
import { chatJson, testConnection, estimateCost } from './ai/client.js';
import { runPipeline, buildDigest, previewCost, topLevelNames } from './ai/planner.js';
import { applyPlan, undoApply, loadJournal, describeJournal } from './ai/apply.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const DEMO = !!window.__DEMO__;

const S = {
  cfg: null,
  all: [],
  digest: null,
  plan: [],
  stats: null,
  taxonomy: null,
  excluded: new Set(),
  abort: null,
  running: false,
  applied: false,
};

/* ================= 通用 UI ================= */
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function busy(on, text = '处理中…') {
  const m = $('#mask');
  m.querySelector('.spin').textContent = text;
  m.hidden = !on;
}
function showMsg(el, text, kind) {
  const n = typeof el === 'string' ? $(el) : el;
  n.className = 'msg' + (kind ? ' msg-' + kind : '');
  n.innerHTML = text;
  n.hidden = false;
}
function hide(el) { (typeof el === 'string' ? $(el) : el).hidden = true; }
const fmt = (n) => (n || 0).toLocaleString('zh-CN');

/* ================= 启动 ================= */
async function init() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
    $$('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + b.dataset.tab));
  });
  $('#btnGoSettings').onclick = () => $('.tab[data-tab="settings"]').click();
  $('#btnRefresh').onclick = () => rescan();
  $('#btnNext1').onclick = () => goto(2);
  $('#btnTest').onclick = () => testConn('#testMsg');
  $('#btnTest2').onclick = () => testConn('#saveMsg');
  $('#btnPrev2').onclick = () => goto(1);
  $('#btnRun').onclick = () => doRun();
  $('#btnCancel').onclick = () => { S.abort?.abort(); };
  $('#btnApply').onclick = () => doApply();
  $('#btnUndo').onclick = () => doUndo();
  $('#btnRestart').onclick = () => resetWizard();
  $('#btnToggleAll').onclick = () => toggleAll();
  $('#optFullUrl').onchange = () => refreshDigestPreview();
  $('#optKeepTops').onchange = () => refreshDigestPreview();
  $('#bizCtx').oninput = () => { /* 提交时读取 */ };

  // 配置表单
  $('#provider').innerHTML = Object.entries(PROVIDERS)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('');
  $('#provider').onchange = () => applyPreset($('#provider').value, true);
  $('#btnSave').onclick = () => saveForm();
  $('#btnEye').onclick = () => {
    const i = $('#apiKey');
    const on = i.type === 'password';
    i.type = on ? 'text' : 'password';
    $('#btnEye').textContent = on ? '隐藏' : '显示';
  };
  $('#btnClearKey').onclick = async () => {
    await clearKey();
    S.cfg = await loadConfig();
    fillForm(S.cfg);
    toast('已清除本机保存的 Key');
  };
  $('#btnClearHist').onclick = async () => {
    await saveConfig({ history: [] });
    S.cfg = await loadConfig();
    renderHistory();
    toast('已清空用量记录');
  };

  S.cfg = await loadConfig();
  fillForm(S.cfg);
  if (DEMO) {
    showMsg('#testMsg',
      '<b>预览模式</b>：当前页面没有运行在扩展环境里（没有 chrome.bookmarks），'
      + '所以用的是内置的示例书签数据。这个模式下点击「开始生成方案」会走<b>本地演示逻辑</b>，'
      + '不会调用真实模型、也不需要 Key —— 目的是让你先看清整套流程。<br>'
      + '真正使用请按「使用说明」把扩展装进 Edge。', 'warn');
  }
  await rescan();
  const j = await loadJournal();
  if (j) renderUndo(j);
}

/* ================= 配置 ================= */
function applyPreset(id, resetFields) {
  const p = getProvider(id);
  $('#provNote').innerHTML = escapeHtml(p.note || '');
  $('#keyHint').textContent = p.keyHint ? '格式：' + p.keyHint : '';
  const link = $('#btnLink');
  if (p.keyUrl) { link.href = p.keyUrl; link.hidden = false; } else { link.hidden = true; }
  $('#modelList').innerHTML = (p.models || []).map((m) => `<option value="${escapeHtml(m)}">`).join('');
  $('#modelHint').textContent = p.models?.length ? '可选：' + p.models.join(' / ') : '按服务商文档填写';
  if (resetFields) {
    $('#baseUrl').value = p.baseUrl || '';
    $('#model').value = p.defaultModel || '';
  }
}

function fillForm(cfg) {
  $('#provider').value = cfg.provider || DEFAULT_PROVIDER;
  applyPreset(cfg.provider || DEFAULT_PROVIDER, false);
  $('#baseUrl').value = cfg.baseUrl || getProvider(cfg.provider).baseUrl || '';
  $('#model').value = cfg.model || getProvider(cfg.provider).defaultModel || '';
  $('#apiKey').value = cfg.apiKey || '';
  $('#temperature').value = cfg.temperature;
  $('#maxTokens').value = cfg.maxTokens;
  $('#concurrency').value = cfg.concurrency;
  $('#batchSize').value = cfg.batchSize;
  $('#hostBatchSize').value = cfg.hostBatchSize;
  $('#language').value = cfg.language || 'zh';
  $('#useLocalRulesFallback').checked = !!cfg.useLocalRulesFallback;

  $('#bizCtx').value = cfg.businessContext || '';
  $('#optKeepTops').checked = !!cfg.keepExistingTops;
  $('#optFullUrl').checked = !!cfg.sendFullUrl;
  $('#optSplit').checked = !!cfg.autoSplitHosts;
  renderHistory();
  renderConnChip();
}

function readForm() {
  return {
    provider: $('#provider').value,
    baseUrl: $('#baseUrl').value.trim(),
    model: $('#model').value.trim(),
    apiKey: $('#apiKey').value.trim(),
    temperature: Number($('#temperature').value) || 0.2,
    maxTokens: Number($('#maxTokens').value) || 4096,
    concurrency: Math.min(4, Math.max(1, Number($('#concurrency').value) || 2)),
    batchSize: Math.min(80, Math.max(10, Number($('#batchSize').value) || 40)),
    hostBatchSize: Math.min(120, Math.max(20, Number($('#hostBatchSize').value) || 60)),
    language: $('#language').value,
    useLocalRulesFallback: $('#useLocalRulesFallback').checked,
    businessContext: $('#bizCtx').value.trim(),
    keepExistingTops: $('#optKeepTops').checked,
    sendFullUrl: $('#optFullUrl').checked,
    autoSplitHosts: $('#optSplit').checked,
  };
}

async function saveForm() {
  const patch = readForm();
  const v = validateBaseUrl(patch.baseUrl || getProvider(patch.provider).baseUrl);
  if (!v.ok) { showMsg('#saveMsg', '❌ ' + v.error, 'err'); return; }

  // 自定义端点需要用户授权，必须在点击事件里申请
  const r = await ensureOriginPermission(patch.baseUrl || getProvider(patch.provider).baseUrl);
  if (!r.granted && !DEMO) {
    showMsg('#saveMsg',
      `⚠️ 未获得 <code>${escapeHtml(r.origin || '')}</code> 的访问权限，模型请求会失败。` +
      `请再点一次「保存配置」并在弹窗中选择「允许」。`, 'warn');
  }

  S.cfg = await saveConfig(patch);
  renderConnChip();
  showMsg('#saveMsg', '✅ 已保存到本机（chrome.storage.local，不参与账号同步）。', 'ok');
  refreshDigestPreview();
}

async function testConn(target) {
  const cfg = { ...readForm() };
  const ep = resolveEndpoint(cfg);
  if (!ep.baseUrl || !ep.model) { showMsg(target, '请先填写 Base URL 和模型名。', 'warn'); return; }
  busy(true, '正在测试连接…');
  try {
    const res = await testConnection({
      baseUrl: ep.baseUrl, model: ep.model, apiKey: cfg.apiKey,
      temperature: 0, maxTokens: 32, jsonMode: ep.jsonMode,
    });
    if (res.ok) {
      const extra = res.models?.length
        ? `<br>该端点可用模型 ${res.models.length} 个，例如：${escapeHtml(res.models.slice(0, 6).join(', '))}`
        : (res.sample ? `<br>模型回复：${escapeHtml(res.sample)}` : '');
      showMsg(target, `✅ 连接正常（${res.via === 'models' ? '模型列表接口' : '对话接口'}，${res.ms}ms）${extra}`, 'ok');
    } else {
      showMsg(target, '❌ ' + escapeHtml(res.error || '连接失败'), 'err');
    }
  } catch (e) {
    showMsg(target, '❌ ' + escapeHtml(String(e.message || e)), 'err');
  } finally {
    busy(false);
  }
}

function renderConnChip() {
  const chip = $('#connChip');
  if (DEMO) { chip.textContent = '预览模式'; chip.className = 'chip'; return; }
  const ep = S.cfg ? resolveEndpoint(S.cfg) : null;
  if (S.cfg && isConfigured(S.cfg)) {
    chip.textContent = `${ep.model} · 已配置`;
    chip.className = 'chip ok';
  } else {
    chip.textContent = '未配置模型';
    chip.className = 'chip bad';
  }
  renderConnBox();
}

function renderConnBox() {
  const box = $('#connBox');
  const ep = S.cfg ? resolveEndpoint(S.cfg) : null;
  if (!ep) { box.textContent = '—'; return; }
  const ok = isConfigured(S.cfg);
  box.innerHTML = `
    <div>服务商：<b>${escapeHtml(ep.preset.label)}</b></div>
    <div>端点：<b>${escapeHtml(ep.baseUrl || '(未填)')}</b></div>
    <div>模型：<b>${escapeHtml(ep.model || '(未填)')}</b></div>
    <div>API Key：<b>${S.cfg.apiKey ? escapeHtml(maskKey(S.cfg.apiKey)) : '(未填)'}</b></div>
    <div>并发 ${S.cfg.concurrency} · 每批域名 ${S.cfg.hostBatchSize} · 每批书签 ${S.cfg.batchSize} · 目录语言 ${S.cfg.language === 'en' ? '英文' : '中文'}</div>
    <div style="margin-top:6px">${ok ? '✅ 配置完整，可以进行整理' : '⚠️ 还缺 Key 或模型名，请到「模型配置」补齐'}</div>`;
  $('#btnNext1').disabled = !ok;
}

function renderHistory() {
  const h = S.cfg?.history || [];
  const box = $('#histBox');
  if (!h.length) { box.innerHTML = '<div class="empty">暂无记录</div>'; return; }
  box.innerHTML = h.map((r) => {
    const d = new Date(r.at);
    const pad = (n) => String(n).padStart(2, '0');
    const t = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `<div class="row2">
      <span class="grow"><span class="tt">${escapeHtml(r.model || '')}</span>
        <div class="path">${t} · ${r.bookmarks} 条 · ${r.calls} 次请求 · ${fmt(r.tokens)} tokens${r.cost ? ' · 约 ¥' + r.cost.toFixed(3) : ''}</div></span>
    </div>`;
  }).join('');
}

/* ================= 扫描 ================= */
async function rescan() {
  busy(true, '正在读取书签…');
  try {
    S.all = await getAllBookmarks();
    S.digest = buildDigest(S.all, { digestDetailLimit: 120 });
    $('#subStat').textContent =
      `共 ${fmt(S.all.length)} 条书签 · ${fmt(S.digest.totalHosts)} 个域名 · 分类将由模型归纳`;
    renderScanCards();
    refreshDigestPreview();
  } finally { busy(false); }
  renderConnChip();
}

function renderScanCards() {
  const d = S.digest;
  const loose = S.all.filter((b) => b.path.length === 1 && isBarRoot(b.path[0])).length;
  const tops = topLevelNames(S.all);
  const cards = [
    { k: '书签总数', v: fmt(d.totalBookmarks), cls: '' },
    { k: '不同域名', v: fmt(d.totalHosts), cls: 'good' },
    { k: '顶层目录', v: tops.length, cls: '' },
    { k: '收藏栏散落', v: loose, cls: loose > 20 ? 'warn' : '' },
  ];
  $('#scanCards').innerHTML = cards.map((c) => `
    <div class="card2 ${c.cls}"><div class="k">${c.k}</div><div class="v">${c.v}</div></div>`).join('');
}

let _previewCfg = null;
function refreshDigestPreview() {
  if (!S.digest) return;
  const cfg = { ...(S.cfg || {}), ...readForm() };
  _previewCfg = cfg;
  const d = buildDigest(S.all, { digestDetailLimit: 120 });
  S.digest = d;

  let text = d.text;
  if (cfg.sendFullUrl) {
    // 勾了完整 URL，摘要里补上行首域名之外的信息量提示
    text = '# 已开启「完整 URL」：请求中会额外携带每条书签的完整网址\n\n' + text;
  }
  $('#digestPreview').textContent = text;
  $('#digestCount').textContent = d.detailedCount;

  const c = previewCost(d, cfg);
  const p = getProvider(cfg.provider).pricePerMTok || { in: 0, out: 0 };
  const money = p.in || p.out
    ? ` · 预估输入约 ¥${((c.totalIn / 1e6) * p.in).toFixed(3)} 起`
    : '';
  $('#costEst').textContent = `预估首次请求输入 ≈ ${fmt(c.totalIn)} tokens（${c.hostChunks} 批）${money}`;
  $('#btnNext1').disabled = !isConfigured(cfg) && !DEMO;
}

/* ================= 向导导航 ================= */
function goto(n) {
  [1, 2, 3, 4].forEach((i) => { $('#s' + i).hidden = i !== n; });
  $$('.step').forEach((el) => {
    const s = Number(el.dataset.s);
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
  $('#steps').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetWizard() {
  S.plan = []; S.stats = null; S.taxonomy = null; S.excluded.clear(); S.applied = false;
  $('#runLog').innerHTML = '';
  hide('#runErr');
  goto(1);
}

/* ================= 运行流水线 ================= */
function makeCallJson(cfg) {
  if (DEMO) return demoCallJson;
  const ep = resolveEndpoint(cfg);
  const callCfg = {
    baseUrl: ep.baseUrl, model: ep.model, apiKey: cfg.apiKey,
    temperature: cfg.temperature, maxTokens: cfg.maxTokens, jsonMode: ep.jsonMode,
  };
  return (messages, opts = {}) => chatJson(callCfg, messages, { retries: 3, ...opts });
}

async function doRun() {
  if (S.running) return;
  const cfg = { ...(S.cfg || {}), ...readForm() };
  if (!isConfigured(cfg) && !DEMO) { goto(1); showMsg('#testMsg', '请先在「模型配置」里填好 API Key。', 'warn'); return; }

  S.running = true;
  S.abort = new AbortController();
  S.excluded.clear();
  $('#btnRun').disabled = true;
  goto(3);
  const log = $('#runLog');
  log.innerHTML = '';
  hide('#runErr');
  setProgress(2, '准备中…');

  const addLog = (html, cls = '') => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = html;
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  };

  const phaseText = {
    digest: '正在聚合书签摘要（按域名归并）',
    taxonomy: '正在让模型归纳分类体系',
    'taxonomy-done': '分类体系已生成',
    hosts: '正在分派域名',
    items: '正在逐条细判「一域名多用途」',
    refine: '正在复核落入兜底目录的条目',
    'refine-done': '复核完成',
    'refine-failed': '复核步骤跳过（不影响已有方案）',
    'taxonomy-retry': '分类体系解析失败，正在重试',
    'taxonomy-fallback': '模型未能给出体系，改用本地规则骨架',
  };

  const t0 = Date.now();
  try {
    const { plan, stats, taxonomy, usage } = await runPipeline({
      bookmarks: S.all,
      cfg,
      callJson: makeCallJson(cfg),
      rules: DEFAULT_RULES,
      signal: S.abort.signal,
      onProgress: (p) => {
        const label = phaseText[p.phase] || p.phase;
        if (p.phase === 'hosts' || p.phase === 'items') {
          setProgress(20 + (p.done / Math.max(1, p.total)) * 60, `${label} ${p.done}/${p.total}`);
          if (p.done === 1 || p.done === p.total) addLog(`${label} ${p.done}/${p.total}`);
        } else {
          setProgress(p.phase === 'done' ? 100 : 15, label);
          const extra = p.taxonomy ? `：得到 ${p.taxonomy.topFolders.length} 个一级目录`
            : (p.refined !== undefined ? `：又救回 ${p.refined}/${p.total} 条`
              : (p.count ? `（${p.count} 条）` : ''));
          addLog(label + extra);
        }
        if (p.usage?.calls) $('#costEst').textContent = `已发出 ${p.usage.calls} 次请求 · ${fmt(p.usage.total_tokens)} tokens`;
      },
    });

    S.plan = plan;
    S.stats = stats;
    S.taxonomy = taxonomy;
    setProgress(100, '完成');

    const p = getProvider(cfg.provider).pricePerMTok || { in: 0, out: 0 };
    const cost = estimateCost(usage, p);
    addLog(`✅ 方案生成完毕：${fmt(stats.total)} 条书签，其中 ${fmt(stats.toMove)} 条需要移动，`
      + `模型判定 ${fmt(stats.fromAi)} 条，本地规则兜底 ${fmt(stats.fromRules)} 条`);
    addLog(`用量：${usage.calls} 次请求 · 输入 ${fmt(usage.prompt_tokens)} · 输出 ${fmt(usage.completion_tokens)}`
      + (cost ? ` · 约 ¥${cost.toFixed(3)}` : ''));
    addLog(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);

    await pushHistory({
      model: resolveEndpoint(cfg).model, bookmarks: stats.total, calls: usage.calls,
      tokens: usage.total_tokens, cost,
    });
    S.cfg = await loadConfig();
    renderHistory();

    renderPlan();
    setTimeout(() => goto(4), 400);
  } catch (e) {
    const aborted = e.name === 'AbortError';
    setProgress(0, aborted ? '已取消' : '失败');
    addLog(aborted ? '已取消本次生成' : '❌ ' + escapeHtml(String(e.message || e)), aborted ? '' : 'err');
    showMsg('#runErr', aborted
      ? '已取消。已产生的请求不会写入任何改动。'
      : escapeHtml(String(e.message || e))
        + '<br>可以在「模型配置」里测试连接，或把「并发请求数」调成 1 后重试。', 'err');
    addLog('提示：本次未对书签做任何修改。');
  } finally {
    S.running = false;
    $('#btnRun').disabled = false;
    S.abort = null;
  }
}

function setProgress(pct, text) {
  $('#progFill').style.width = Math.max(0, Math.min(100, pct)) + '%';
  $('#progText').textContent = text;
}

/* ================= 方案预览 ================= */
function renderPlan() {
  const st = S.stats;
  const cards = [
    { k: '书签总数', v: fmt(st.total), cls: '' },
    { k: '需要移动', v: fmt(st.toMove), cls: st.toMove ? 'warn' : 'good' },
    { k: '模型判定', v: fmt(st.fromAi), cls: 'good' },
    { k: '规则兜底', v: fmt(st.fromRules), cls: '' },
    { k: '待整理', v: fmt(st.fallback), cls: st.fallback > st.total * 0.2 ? 'bad' : '' },
    { k: '一级目录', v: st.taxonomy.topFolders.length, cls: '' },
  ];
  $('#planCards').innerHTML = cards.map((c) => `
    <div class="card2 ${c.cls}"><div class="k">${c.k}</div><div class="v">${c.v}</div></div>`).join('');

  // 体系树
  const counts = new Map(st.folders);
  $('#taxBox').innerHTML = `<h3>模型归纳的目录体系${st.taxonomy.reasoning ? '：' + escapeHtml(st.taxonomy.reasoning) : ''}</h3>`
    + st.taxonomy.topFolders.map((t) => {
      const own = counts.get(t.name) || 0;
      const kids = (t.children || []).map((c) => {
        const n = counts.get(t.name + ' / ' + c.name) || 0;
        return `<div class="tchild">└ ${escapeHtml(c.name)} <span class="tcount">${n} 条${c.desc ? ' · ' + escapeHtml(c.desc) : ''}</span></div>`;
      }).join('');
      return `<div class="tfolder">${escapeHtml(t.name)} <span class="tcount">${own} 条</span></div>${kids}`;
    }).join('');

  renderPlanList();
}

function renderPlanList() {
  const movable = S.plan.filter((p) => p.needsMove);
  const groups = new Map();
  for (const it of movable) {
    const k = it.target.join(' / ');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  let html = '';
  for (const [k, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    html += `<div class="grp"><span>${escapeHtml(k)}</span><span class="no">${items.length} 条</span></div>`;
    for (const it of items.slice(0, 60)) {
      const badge = it.source === 'ai-item' ? '逐条判定' : it.source === 'ai-host' ? '域名判定'
        : it.source === 'rules' ? '本地规则' : '兜底';
      html += `<div class="row2">
        <input type="checkbox" data-bm="${escapeHtml(it.bookmark.id)}" ${S.excluded.has(it.bookmark.id) ? '' : 'checked'}>
        <span class="grow">
          <div class="tt">${escapeHtml(it.bookmark.title || '(无标题)')}</div>
          <div class="path">${escapeHtml(it.currentPath.join(' / ') || '(收藏栏根)')} → ${escapeHtml(it.target.join(' / '))}</div>
        </span>
        <span class="no">${badge}</span>
      </div>`;
    }
    if (items.length > 60) html += `<div class="row2"><span class="grow path">… 该目录另有 ${items.length - 60} 条未展开显示（仍会执行）</span></div>`;
  }
  $('#planList').innerHTML = html || '<div class="empty">没有需要移动的书签，当前结构已经和方案一致</div>';

  $('#planList').querySelectorAll('input[data-bm]').forEach((cb) => {
    cb.onchange = () => {
      const id = cb.dataset.bm;
      if (cb.checked) S.excluded.delete(id); else S.excluded.add(id);
      updatePlanInfo();
    };
  });
  updatePlanInfo();
}

function updatePlanInfo() {
  const movable = S.plan.filter((p) => p.needsMove);
  const willDo = movable.filter((p) => !S.excluded.has(p.bookmark.id));
  const folders = new Set(willDo.map((p) => p.target.join(' / ')));
  $('#planInfo').innerHTML = `将移动 <b>${fmt(willDo.length)}</b> 条，涉及 <b>${folders.size}</b> 个目录`
    + (S.excluded.size ? ` · 已排除 ${S.excluded.size} 条` : '');
  $('#btnApply').disabled = willDo.length === 0 || S.applied;
}

function toggleAll() {
  const movable = S.plan.filter((p) => p.needsMove);
  const allSelected = movable.every((p) => !S.excluded.has(p.bookmark.id));
  S.excluded.clear();
  if (allSelected) movable.forEach((p) => S.excluded.add(p.bookmark.id));
  renderPlanList();
}

/* ================= 执行 / 撤销 ================= */
async function doApply() {
  const todo = S.plan.filter((p) => p.needsMove && !S.excluded.has(p.bookmark.id));
  if (!todo.length) return;
  if (!confirm(`即将移动 ${todo.length} 条书签。\n\n只会「移动」，不会删除任何书签。\n执行后如果效果不满意，可以点「撤销本次整理」还原。\n\n确认执行？`)) return;

  busy(true, '正在执行…');
  try {
    const res = await applyPlan(todo, (done, total) => busy(true, `正在移动 ${done}/${total}…`));
    S.applied = true;
    $('#btnApply').disabled = true;
    if (res.failed?.length) {
      toast(`完成，但有 ${res.failed.length} 条失败（多为父目录被删）`);
    } else {
      toast(`✅ 已移动 ${res.moved} 条，新建 ${res.created} 个目录`);
    }
    renderUndo(res.journal);
    await rescan();
  } catch (e) {
    toast('执行失败：' + escapeHtml(String(e.message || e)));
  } finally { busy(false); }
}

function renderUndo(journal) {
  const d = describeJournal(journal);
  if (!d) { hide('#undoRow'); return; }
  $('#undoRow').hidden = false;
  $('#btnUndo').disabled = false;
  $('#undoInfo').textContent = `${d.at} 的整理共移动 ${d.moves} 条、新建 ${d.createdFolders} 个目录`;
}

async function doUndo() {
  const j = await loadJournal();
  if (!j) { toast('没有可撤销的记录'); return; }
  const d = describeJournal(j);
  if (!confirm(`撤销 ${d.at} 的整理？\n\n将把 ${d.moves} 条书签移回原目录，并清理本次新建的空目录。\n已删除的书签无法通过此操作恢复（但本插件从不删除书签）。\n\n确认撤销？`)) return;
  busy(true, '正在撤销…');
  try {
    const r = await undoApply(j, (done, total) => busy(true, `正在还原 ${done}/${total}…`));
    toast(`✅ 已还原 ${r.restored} 条，清理空目录 ${r.removedFolders} 个`);
    hide('#undoRow');
    S.applied = false;
    await rescan();
    if (S.plan.length) renderPlanList();
  } catch (e) {
    toast('撤销失败：' + escapeHtml(String(e.message || e)));
  } finally { busy(false); }
}

/* ================= 演示模式的内置「模型」 ================= */
/**
 * 预览模式专用：不联网、不需要 Key，用一份轻量规则模拟模型的三阶段输出，
 * 让人先把整条流程点通。真实扩展环境里 window.__DEMO__ 为 false，这段永不执行。
 */
const DEMO_BUCKETS = [
  { name: '01 · 电商与购物', kids: ['平台后台', '商品与店铺', '货源批发'], re: /(ozon|wildberries|amazon|aliexpress|ebay|shopee|temu|taobao|tmall|1688|jd\.com|pinduoduo|yangkeduo|alibaba|mercadolibre|rakuten|etsy|拼多多|淘宝|京东|抖店)/ },
  { name: '02 · AI 工具', kids: ['对话与模型', '图像与视频', '智能体平台'], re: /(openai|chatgpt|anthropic|claude|deepseek|moonshot|kimi|qwen|tongyi|dashscope|bigmodel|zhipu|coze|dify|huggingface|midjourney|runway|suno|perplexity|ollama|siliconflow|openrouter|gemini|poe)/ },
  { name: '03 · 开发与云服务', kids: ['代码托管', '文档与问答', '云平台'], re: /(github|gitlab|gitee|stackoverflow|npmjs|developer\.mozilla|juejin|csdn|segmentfault|vercel|netlify|docker|aliyun|tencent\.com|cloudflare|aws\.amazon|azure|huaweicloud|oracle|jetbrains|postman)/ },
  { name: '04 · 办公与文档', kids: ['协作平台', '在线文档', '邮箱'], re: /(notion|feishu|lark|yuque|tencent-docs|docs\.qq|google\.com\/docs|wps|office|outlook|mail|zoho|slack|dingtalk|zoom|meeting)/ },
  { name: '05 · 学习与知识', kids: ['课程', '百科与论文', '语言学习'], re: /(coursera|udemy|edx|khanacademy|wikipedia|arxiv|zhihu|wiki|britannica|duolingo|ielts|toefl|open\.163|study)/ },
  { name: '06 · 内容与社媒', kids: ['视频', '图文社区', '播客'], re: /(youtube|bilibili|douyin|tiktok|xiaohongshu|weibo|twitter|x\.com|facebook|instagram|reddit|medium|substack|podcast|spotify|netflix|iqiyi|youku)/ },
  { name: '07 · 设计与素材', kids: ['设计工具', '图片素材', '图标字体'], re: /(figma|canva|unsplash|pexels|pixabay|dribbble|behance|iconfont|flaticon|千图|花瓣|稿定|remove\.bg|photopea)/ },
  { name: '08 · 物流与财务', kids: ['物流查询', '支付与税务', '汇率'], re: /(4px|yanwen|sf-express|dhl|fedex|ups\.com|track|paypal|stripe|payoneer|pingpong|worldfirst|tax|invoice|exchange|xe\.com|wise)/ },
  { name: '09 · 新闻与资讯', kids: [], re: /(news|36kr|huxiu|tmtpost|reuters|bloomberg|cnbeta|ithome|sspai|zaobao)/ },
  { name: '10 · 工具与效率', kids: ['在线工具', '效率应用'], re: /(tool|工具|convert|compress|qr|shorturl|bit\.ly|t\.ly|wetransfer|speedtest|calendar|todo|translate)/ },
];
const DEMO_FALLBACK = '99 · 待整理';

function demoBucketOf(host, title) {
  const blob = (host + ' ' + (title || '')).toLowerCase();
  for (const b of DEMO_BUCKETS) {
    if (b.re.test(blob)) {
      const kid = b.kids.length ? b.kids[blob.match(/seller|admin|后台|管理|console|dashboard/) ? 0 : Math.min(1, b.kids.length - 1)] : null;
      return kid ? [b.name, kid] : [b.name];
    }
  }
  return [DEMO_FALLBACK];
}

async function demoCallJson(messages, opts = {}) {
  await new Promise((r) => setTimeout(r, 220)); // 模拟网络耗时
  const sys = messages[0]?.content || '';
  const user = messages[1]?.content || '';
  const usage = { prompt_tokens: Math.ceil(user.length / 3), completion_tokens: 200, total_tokens: 260 };

  // 阶段 A：归纳体系
  if (sys.includes('信息架构师')) {
    const used = new Set();
    for (const line of user.split('\n')) {
      const m = line.match(/^- ([^ ]+) \(/);
      if (!m) continue;
      for (const b of DEMO_BUCKETS) if (b.re.test(m[1])) used.add(b.name);
    }
    const tops = DEMO_BUCKETS.filter((b) => used.has(b.name)).map((b) => ({
      name: b.name, children: b.kids.map((k) => ({ name: k, desc: '' })),
    }));
    return { data: { topFolders: tops, fallbackFolder: DEMO_FALLBACK, reasoning: '演示模式：按域名与标题关键词归纳' }, usage };
  }

  // 阶段 B：域名分派
  if (sys.includes('书签归档助手') && user.includes('待归类域名')) {
    const assign = {};
    const splitHosts = [];
    for (const line of user.split('\n')) {
      if (!line.startsWith('- ')) continue;
      const host = line.slice(2).split(/[\s(]/)[0];
      if (!host) continue;
      assign[host] = demoBucketOf(host, line);
      // 一个站点多种用法的，交给阶段 C 逐条判断
      if (/(ozon|amazon|aliexpress|taobao|1688|jd\.com|wildberries|ebay|shopee)/.test(host)) splitHosts.push(host);
    }
    return { data: { assign, splitHosts }, usage };
  }

  // 阶段 C：逐条细判
  if (sys.includes('同一个站点')) {
    const assign = {};
    const lines = user.split('\n').slice(1);
    lines.forEach((ln, i) => {
      const mm = ln.match(/^\d+\.\s*(.*)$/);
      if (!mm) return;
      const title = mm[1];
      const host = (sys.match(/「([^」]+)」/) || [])[1] || '';
      const p = demoBucketOf(host, title);
      let path = p;
      const isAdmin = /(后台|管理|卖家|商家|seller|admin|dashboard|console|工作台|控制台|订单|order|财务)/.test(title);
      const kids = (DEMO_BUCKETS.find((b) => title && b.name === p[0]) || {}).kids || [];
      if (kids.length && p.length > 1) path = [p[0], isAdmin ? kids[0] : p[1]];
      assign[String(i)] = path;
    });
    return { data: { assign }, usage };
  }

  // 阶段 D：复核
  if (sys.includes('没能确定归属')) {
    const assign = {};
    user.split('\n').forEach((ln, i) => {
      const mm = ln.match(/^\d+\.\s*(.*?)\s+域名:(\S+)$/);
      if (mm) assign[String(i)] = demoBucketOf(mm[2], mm[1]);
    });
    return { data: { assign }, usage };
  }

  return { data: {}, usage };
}

init().catch((e) => {
  document.body.insertAdjacentHTML('beforeend',
    `<div class="msg msg-err" style="margin:20px">初始化失败：${escapeHtml(String(e.message || e))}</div>`);
});
