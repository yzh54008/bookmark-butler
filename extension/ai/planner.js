/**
 * ai/planner.js — AI 整理流水线（纯逻辑，不碰 chrome API，方便单测）
 *
 * 数据流：
 *   书签数组 → buildDigest（按域名聚合，token 骤降）
 *            → 阶段A 归纳分类体系
 *            → 阶段B 域名级分派（并发分批）
 *            → 阶段C 对「一域名多用途」逐条细判
 *            → 兜底：本地规则引擎 + 最后一次复核
 *            → plan（每条书签的最终目标路径 + 来源标注）
 */
import { classify, DEFAULT_RULES, UNCLASSIFIED } from '../rules.js';
import {
  taxonomyMessages, hostAssignMessages, itemAssignMessages, refineMessages, flattenPaths,
} from './prompts.js';
import { estimateTokens } from './client.js';

const OTHER_ROOTS = /^(收藏夹栏|书签栏|其他收藏夹|移动收藏夹|Bookmarks bar|Other bookmarks|Mobile bookmarks)$/i;

/* ---------------- 摘要聚合 ---------------- */

/**
 * 按域名聚合，生成喂给模型的摘要。
 * 这一步是省 token 的关键：386 条书签通常只有 100~150 个域名。
 */
export function buildDigest(bookmarks, cfg = {}) {
  const byHost = new Map();
  for (const b of bookmarks) {
    const host = b.host || '(无域名)';
    if (!byHost.has(host)) {
      byHost.set(host, { host, count: 0, samples: [], seen: new Set(), tops: new Map(), items: [] });
    }
    const g = byHost.get(host);
    g.count++;
    g.items.push(b);
    const top = b.path[1];
    if (top && !OTHER_ROOTS.test(top)) g.tops.set(top, (g.tops.get(top) || 0) + 1);
    const t = (b.title || '').trim();
    if (t && !g.seen.has(t) && g.samples.length < 4) {
      g.seen.add(t);
      g.samples.push(t.length > 42 ? t.slice(0, 42) + '…' : t);
    }
    if (g.samples.length === 0 && t) g.samples.push(t.slice(0, 42));
  }

  const hosts = [...byHost.values()].map((g) => {
    const cur = [...g.tops.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      host: g.host,
      count: g.count,
      samples: g.samples.length ? g.samples : ['(无标题)'],
      currentTop: cur ? cur[0] : '',
      items: g.items,
    };
  }).sort((a, b) => b.count - a.count);

  // 明细上限：超出部分只列域名，控制 token
  const detailLimit = cfg.digestDetailLimit || 120;
  const detailed = hosts.slice(0, detailLimit);
  const rest = hosts.slice(detailLimit);

  const lines = detailed.map((h) => {
    const cur = h.currentTop ? `  [现:${h.currentTop}]` : '';
    return `- ${h.host} (${h.count})${cur}\n    ${h.samples.join(' | ')}`;
  });
  if (rest.length) {
    lines.push('');
    lines.push(`其余 ${rest.length} 个低频域名（仅有域名，无标题样本）：`);
    lines.push('  ' + rest.map((h) => `${h.host}(${h.count})`).join(', '));
  }

  const text = lines.join('\n');

  // 低频域名也要参与分派，但没有样本，构造成同样的结构
  const assignable = hosts.map((h) => ({
    host: h.host,
    count: h.count,
    samples: h.samples,
    currentTop: h.currentTop,
  }));

  return {
    text,
    totalBookmarks: bookmarks.length,
    totalHosts: hosts.length,
    hosts,          // 含 items，供后续步骤使用
    assignable,     // 供阶段 B 使用
    detailedCount: detailed.length,
  };
}

/** 发送前的用量预估，让用户知道这一次大概花多少 */
export function previewCost(digest, cfg) {
  const stageA = estimateTokens(digest.text) + 500;
  const hosts = digest.assignable.length;
  const hostChunks = Math.max(1, Math.ceil(hosts / (cfg.hostBatchSize || 60)));
  const paths = 600; // 合法路径清单大致固定开销
  const hostTokens = hostChunks * (paths + estimateTokens(digest.text) / Math.max(1, hostChunks) + 250);
  return {
    stageA: Math.round(stageA),
    stageB: Math.round(hostTokens),
    totalIn: Math.round(stageA + hostTokens),
    hostChunks,
  };
}

/* ---------------- 体系校验与规范化 ---------------- */

export function normalizeTaxonomy(raw, cfg = {}) {
  const fb = (raw?.fallbackFolder || '').trim() || '99 · 待整理';
  const tops = [];
  const seenTop = new Set();
  for (const t of raw?.topFolders || []) {
    let name = String(t?.name || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    name = name.slice(0, 16);
    if (seenTop.has(name)) continue;
    seenTop.add(name);
    const children = [];
    const seenC = new Set();
    for (const c of t.children || []) {
      const cn = String(c?.name || '').trim().slice(0, 16);
      if (!cn || seenC.has(cn)) continue;
      seenC.add(cn);
      children.push({ name: cn, desc: String(c?.desc || '').slice(0, 40) });
      if (children.length >= 6) break;
    }
    tops.push({ name, children });
    if (tops.length >= 16) break;
  }
  if (!tops.length) throw new Error('模型没有给出任何有效的顶层目录');

  // 按序号排序，保证目录顺序稳定
  tops.sort((a, b) => seqOf(a.name) - seqOf(b.name) || a.name.localeCompare(b.name));

  return { topFolders: tops, fallbackFolder: fb, reasoning: String(raw?.reasoning || '').slice(0, 120) };
}

function seqOf(name) {
  const m = String(name).match(/^(\d{1,2})\s*[·.、\-]/);
  return m ? Number(m[1]) : 999;
}

/** 判断路径是否合法；不合法时尝试模糊对齐（模型常漏掉序号前缀） */
export function coercePath(path, taxonomy) {
  const legal = flattenPaths(taxonomy);
  if (!Array.isArray(path) || !path.length) return null;
  const norm = path.map((s) => String(s || '').trim()).filter(Boolean);
  if (!norm.length) return null;

  // 1) 完全一致
  for (const p of legal) {
    if (p.length === norm.length && p.every((s, i) => s === norm[i])) return p.slice();
  }
  // 2) 忽略序号前缀比对
  const strip = (s) => s.replace(/^\d{1,2}\s*[·.、\-]\s*/, '').trim();
  for (const p of legal) {
    if (p.length === norm.length && p.every((s, i) => strip(s) === strip(norm[i]))) return p.slice();
  }
  // 3) 只匹配一级（二级写错时降级到一级）
  for (const p of legal) {
    if (p.length === 1 && strip(p[0]) === strip(norm[0])) return p.slice();
  }
  // 4) 一级匹配上、二级不存在 → 取该一级
  for (const p of legal) {
    if (p.length === 1 && norm.length > 1 && strip(p[0]) === strip(norm[0])) return p.slice();
  }
  // 5) 拿路径最后一段去找唯一匹配的二级
  const last = strip(norm[norm.length - 1]);
  const hit = legal.filter((p) => p.length === 2 && strip(p[1]) === last);
  if (hit.length === 1) return hit[0].slice();

  return null;
}

/* ---------------- 并发分批执行 ---------------- */

async function mapLimit(items, limit, worker, signal) {
  const out = new Array(items.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(limit || 1, items.length || 1));
  async function run() {
    while (true) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, run));
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ---------------- 主流水线 ---------------- */

/**
 * @param {object} p
 * @param {Array} p.bookmarks          来自 shared.getAllBookmarks()
 * @param {object} p.cfg               模型配置
 * @param {Function} p.callJson        (messages, opts) => {data, usage}，由调用方注入（可测）
 * @param {object} [p.rules]           本地规则，用于兜底
 * @param {Function} [p.onProgress]    进度回调
 * @param {AbortSignal} [p.signal]
 * @param {object} [p.taxonomy]        若已生成过体系可复用，跳过阶段 A
 */
export async function runPipeline({
  bookmarks, cfg, callJson, rules = DEFAULT_RULES, onProgress, signal, taxonomy: presetTaxonomy,
}) {
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };
  const bump = (u) => {
    if (!u) return;
    usage.prompt_tokens += u.prompt_tokens || 0;
    usage.completion_tokens += u.completion_tokens || 0;
    usage.total_tokens += u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0);
    usage.calls++;
  };
  const report = (phase, extra = {}) => onProgress && onProgress({ phase, usage: { ...usage }, ...extra });

  report('digest');
  const digest = buildDigest(bookmarks, cfg);
  const costPreview = previewCost(digest, cfg);

  /* --- 阶段 A：分类体系 --- */
  let taxonomy = presetTaxonomy;
  if (!taxonomy) {
    report('taxonomy', { hosts: digest.totalHosts });
    const existingTops = cfg.keepExistingTops ? topLevelNames(bookmarks) : [];
    let lastErr = null;
    for (let attempt = 0; attempt < 2 && !taxonomy; attempt++) {
      try {
        const r = await callJson(taxonomyMessages(digest, cfg, existingTops), { signal, jsonObject: true });
        bump(r.usage);
        taxonomy = normalizeTaxonomy(r.data, cfg);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        report('taxonomy-retry', { attempt: attempt + 1, error: String(e.message || e) });
      }
    }
    if (!taxonomy) {
      // 模型彻底给不出体系时，退到本地规则的骨架，保证「整理」这件事仍然能完成
      taxonomy = taxonomyFromRules(rules);
      report('taxonomy-fallback', { error: String(lastErr?.message || '') });
    }
    report('taxonomy-done', { taxonomy });
  }

  const legal = flattenPaths(taxonomy);
  const fbPath = [taxonomy.fallbackFolder];

  /* --- 阶段 B：域名级分派 --- */
  const hostChunks = chunk(digest.assignable, cfg.hostBatchSize || 60);
  report('hosts', { total: hostChunks.length, done: 0 });
  let hostDone = 0;
  const hostResults = await mapLimit(
    hostChunks,
    cfg.concurrency || 2,
    async (hc) => {
      const r = await callJson(hostAssignMessages(hc, taxonomy, cfg), { signal, jsonObject: true });
      bump(r.usage);
      hostDone++;
      report('hosts', { total: hostChunks.length, done: hostDone });
      return r.data || {};
    },
    signal,
  );

  const hostAssign = new Map();   // host -> path
  const splitHosts = new Set();
  for (const hr of hostResults) {
    for (const [h, p] of Object.entries(hr.assign || {})) {
      const ok = coercePath(p, taxonomy);
      if (ok) hostAssign.set(h, ok);
    }
    for (const h of hr.splitHosts || []) if (typeof h === 'string') splitHosts.add(h.trim());
  }
  // 模型漏掉的域名 → 走本地规则 / 兜底
  const missingHosts = digest.assignable.filter((h) => !hostAssign.has(h.host));
  for (const h of missingHosts) {
    const sample = (h.samples || [])[0] || '';
    const guess = classify({ url: `https://${h.host}/`, title: sample, path: [] }, rules);
    hostAssign.set(h.host, coercePath(guess, taxonomy) || fbPath);
  }

  /* --- 阶段 C：一域名多用途逐条细判 --- */
  const targetSplit = [];
  for (const h of digest.hosts) {
    const isSplit = splitHosts.has(h.host) || (cfg.autoSplitHosts && heuristicSplit(h));
    if (isSplit) targetSplit.push(h);
  }
  const itemAssign = new Map(); // bookmark.id -> path
  if (targetSplit.length) {
    const jobs = [];
    for (const h of targetSplit) {
      for (const c of chunk(h.items, cfg.batchSize || 40)) jobs.push({ host: h.host, items: c });
    }
    report('items', { total: jobs.length, done: 0 });
    let itemDone = 0;
    const res = await mapLimit(
      jobs,
      cfg.concurrency || 2,
      async (job) => {
        const r = await callJson(itemAssignMessages(job.items, taxonomy, cfg, job.host), { signal, jsonObject: true });
        bump(r.usage);
        itemDone++;
        report('items', { total: jobs.length, done: itemDone });
        return { job, data: r.data || {} };
      },
      signal,
    );
    for (const { job, data } of res) {
      for (const [idx, p] of Object.entries(data.assign || {})) {
        const i = Number(idx);
        if (!Number.isInteger(i) || i < 0 || i >= job.items.length) continue;
        const ok = coercePath(p, taxonomy);
        if (ok) itemAssign.set(job.items[i].id, ok);
      }
    }
  }

  /* --- 兜底复核：把所有落到「待整理」的条目再问一次（含模型主动丢进兜底的） --- */
  const fbKey = fbPath.join('/');
  const inFallback = (b) => {
    const t = itemAssign.get(b.id) || hostAssign.get(b.host);
    return !t || t.join('/') === fbKey;
  };
  const unresolved = bookmarks.filter(inFallback);
  let refined = 0;
  if (unresolved.length <= 120 && unresolved.length > 0) {
    try {
      report('refine', { count: unresolved.length });
      // 分小批，避免一次送太多导致输出被截断
      for (const part of chunk(unresolved, 50)) {
        const r = await callJson(refineMessages(part, taxonomy, cfg), { signal, jsonObject: true });
        bump(r.usage);
        for (const [idx, p] of Object.entries(r.data?.assign || {})) {
          const i = Number(idx);
          if (!Number.isInteger(i) || i < 0 || i >= part.length) continue;
          const ok = coercePath(p, taxonomy);
          if (ok && ok.join('/') !== fbKey) { itemAssign.set(part[i].id, ok); refined++; }
        }
      }
      report('refine-done', { refined, total: unresolved.length });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      report('refine-failed', { error: String(e.message || e) });
    }
  }

  /* --- 组装最终计划 --- */
  const plan = [];
  for (const b of bookmarks) {
    const currentPath = b.path.slice(1);
    let target = itemAssign.get(b.id) || hostAssign.get(b.host);
    let source = itemAssign.has(b.id) ? 'ai-item' : 'ai-host';
    if (!target) {
      if (cfg.useLocalRulesFallback) {
        const g = classify(b, rules);
        target = coercePath(g, taxonomy) || fbPath;
        source = 'rules';
      } else {
        target = fbPath;
        source = 'fallback';
      }
    }
    plan.push({
      bookmark: b,
      target,
      currentPath,
      needsMove: target.join('/') !== currentPath.join('/'),
      source,
    });
  }

  /* --- 汇总 --- */
  const byFolder = new Map();
  for (const it of plan) {
    const k = it.target.join(' / ');
    byFolder.set(k, (byFolder.get(k) || 0) + 1);
  }
  const stats = {
    total: plan.length,
    toMove: plan.filter((p) => p.needsMove).length,
    fromAi: plan.filter((p) => p.source.startsWith('ai')).length,
    fromRules: plan.filter((p) => p.source === 'rules').length,
    fallback: plan.filter((p) => p.target.join('/') === fbPath.join('/')).length,
    folders: [...byFolder.entries()].sort((a, b) => b[1] - a[1]),
    splitHosts: targetSplit.length,
    refined,
    refinedFrom: unresolved.length,
    usage,
    costPreview,
    taxonomy,
  };
  report('done', { stats });
  return { plan, stats, taxonomy, digest, usage };
}

/**
 * 降级用：模型给不出体系时，拿本地规则的顶层目录当骨架。
 * 这样即便模型不可用，整理流程也不会中断（后续阶段仍会尝试让模型分派）。
 */
export function taxonomyFromRules(rules) {
  const tops = (rules?.topFolders || []).map((n) => ({ name: n, children: [] }));
  if (!tops.length) tops.push({ name: '01 · 未分类', children: [] });
  return { topFolders: tops, fallbackFolder: '99 · 待整理', reasoning: '模型未能给出体系，暂用本地规则骨架' };
}

/** 顶层目录名（用于「沿用现有目录」） */
export function topLevelNames(bookmarks) {  const s = new Set();
  for (const b of bookmarks) {
    const t = b.path[1];
    if (t && !OTHER_ROOTS.test(t)) s.add(t);
  }
  return [...s];
}

/**
 * 启发式判断「这个域名是否需要逐条判断」。
 * 逻辑：条数够多，且标题之间差异大（不是同一批页面），
 * 同时标题里同时出现「后台类词」和「前台类词」，说明一个站点两种用法。
 */
export function heuristicSplit(h) {
  if (h.count < 5) return false;
  const titles = h.items.map((b) => (b.title || '').toLowerCase());
  const uniq = new Set(titles).size;
  if (uniq / h.count < 0.6) return false;
  const blob = titles.join(' ');
  const admin = /(后台|管理|管理中心|卖家|商家|seller|admin|dashboard|console|工作台|控制台|center|account|财务|订单|order)/;
  const front = /(类目|分类|新品|热卖|榜单|搜索|详情|商品页|\d{3,}|款|型号|规格|cat|search|list)/;
  return admin.test(blob) && front.test(blob);
}

export { chunk, mapLimit };
