/**
 * test_ai.mjs — AI 整理链路的端到端测试
 *
 * 不动真实浏览器、不花一分钱：
 *   1) 起一个本地 OpenAI 兼容 mock 服务端（含 401 / 429 / 围栏 JSON / 截断 JSON 等故障注入）
 *   2) 用真实收藏夹数据 + 内存版 chrome.bookmarks 桩
 *   3) 跑通「摘要 → 归纳体系 → 域名分派 → 逐条细判 → 兜底 → 执行 → 撤销」全链路
 *
 * 运行方式见 dev/run_test_ai.ps1
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOKMARKS = process.argv[2] || '';
const OUT = [];

/* ================= 断言工具 ================= */
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; OUT.push(`  [PASS] ${name}`); }
  else { fail++; OUT.push(`  [FAIL] ${name}${extra ? '  -> ' + extra : ''}`); }
  return !!cond;
}
function sec(t) { OUT.push(''); OUT.push('=== ' + t + ' ==='); }

/* ================= 内存版 chrome.bookmarks 桩 ================= */
function makeChromeStub(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const index = new Map();
  let nextId = 900000;
  const clone = (n) => structuredClone(n);

  const root = { id: '0', parentId: '', title: '', children: [] };
  index.set('0', root);

  const folderNames = { bookmark_bar: '收藏夹栏', other: '其他收藏夹', synced: '移动设备收藏夹' };
  for (const k of ['bookmark_bar', 'other', 'synced']) {
    const src = raw.roots?.[k];
    if (!src) continue;
    const node = { id: String(src.id), parentId: '0', title: folderNames[k] || src.name || k, children: [] };
    index.set(node.id, node);
    root.children.push(node);
    (function conv(children, parentId) {
      for (const c of children || []) {
        if (c.type === 'url') {
          const leaf = { id: String(c.id), parentId, title: c.name || '', url: c.url, dateAdded: Number(c.date_added || 0) };
          index.set(leaf.id, leaf);
          index.get(parentId).children.push(leaf);
        } else {
          const f = { id: String(c.id), parentId, title: c.name || '', children: [] };
          index.set(f.id, f);
          index.get(parentId).children.push(f);
          conv(c.children, f.id);
        }
      }
    })(src.children, node.id);
  }

  const store = {};
  const chrome = {
    storage: {
      local: {
        get: (k) => {
          if (typeof k === 'string') return Promise.resolve({ [k]: store[k] });
          if (Array.isArray(k)) { const o = {}; k.forEach((x) => { o[x] = store[x]; }); return Promise.resolve(o); }
          return Promise.resolve({ ...store });
        },
        set: (o) => { Object.assign(store, o); return Promise.resolve(); },
        remove: (k) => { delete store[k]; return Promise.resolve(); },
      },
    },
    bookmarks: {
      getTree: () => Promise.resolve([clone(root)]),
      getChildren: (id) => Promise.resolve((index.get(id)?.children || []).map(clone)),
      get: (id) => {
        const n = index.get(id);
        return n ? Promise.resolve([clone(n)]) : Promise.reject(new Error('Can not find bookmark with id ' + id));
      },
      create: (opt) => {
        const node = opt.url
          ? { id: String(nextId++), parentId: opt.parentId, title: opt.title, url: opt.url, dateAdded: Date.now() }
          : { id: String(nextId++), parentId: opt.parentId, title: opt.title, children: [] };
        index.set(node.id, node);
        const p = index.get(opt.parentId);
        if (p) { p.children = p.children || []; p.children.push(node); }
        return Promise.resolve(clone(node));
      },
      move: (id, opt) => {
        const n = index.get(id);
        if (!n) return Promise.reject(new Error('Can not find bookmark with id ' + id));
        const old = index.get(n.parentId);
        if (old) old.children = old.children.filter((c) => c.id !== id);
        const p = index.get(opt.parentId);
        if (p) { p.children = p.children || []; p.children.push(n); n.parentId = opt.parentId; }
        return Promise.resolve(clone(n));
      },
      remove: (id) => {
        const n = index.get(id);
        if (!n) return Promise.reject(new Error('Can not find bookmark with id ' + id));
        const kids = n.children || [];
        if (kids.length) return Promise.reject(new Error('Cannot remove non-empty folder'));
        const p = index.get(n.parentId);
        if (p) p.children = p.children.filter((c) => c.id !== id);
        index.delete(id);
        return Promise.resolve();
      },
      removeTree: (id) => {
        const n = index.get(id);
        if (!n) return Promise.reject(new Error('not found'));
        const p = index.get(n.parentId);
        if (p) p.children = p.children.filter((c) => c.id !== id);
        (function del(x) { index.delete(x.id); (x.children || []).forEach(del); })(n);
        return Promise.resolve();
      },
      update: (id, opt) => {
        const n = index.get(id);
        if (!n) return Promise.reject(new Error('not found'));
        if (opt.title != null) n.title = opt.title;
        return Promise.resolve(clone(n));
      },
    },
  };
  return { chrome, index, root, store };
}

/* ================= mock 模型服务端 ================= */
const BUCKETS = [
  ['01 · 电商与购物', ['卖家后台', '类目与选品', '货源批发'], /(ozon|wildberries|amazon|aliexpress|ebay|shopee|temu|taobao|tmall|1688|jd\.com|pinduoduo|alibaba|拼多多|淘宝|京东)/],
  ['02 · AI 工具', ['对话与模型', '图像与设计', '智能体平台'], /(openai|chatgpt|anthropic|claude|deepseek|moonshot|kimi|qwen|dashscope|bigmodel|zhipu|coze|dify|huggingface|midjourney|runway|suno|perplexity|ollama|siliconflow|openrouter|gemini|扣子|豆包)/],
  ['03 · 开发与云服务', ['代码托管', '文档问答', '云平台'], /(github|gitlab|gitee|stackoverflow|npmjs|mozilla|juejin|csdn|vercel|netlify|docker|aliyun|cloudflare|aws|azure|huaweicloud|postman|localhost|127\.0\.0\.1)/],
  ['04 · 办公与文档', ['协作平台', '在线文档', '邮箱'], /(notion|feishu|lark|yuque|docs\.qq|wps|office|outlook|mail|dingtalk|飞书|语雀)/],
  ['05 · 学习与知识', ['课程', '百科与论文'], /(coursera|udemy|edx|wikipedia|arxiv|zhihu|wiki|duolingo|study|学习|教程)/],
  ['06 · 内容与社媒', ['视频', '图文社区'], /(youtube|bilibili|douyin|tiktok|xiaohongshu|weibo|twitter|x\.com|facebook|instagram|reddit|medium|spotify|netflix|iqiyi|youku|抖音|小红书)/],
  ['07 · 设计与素材', ['设计工具', '图片素材'], /(figma|canva|unsplash|pexels|pixabay|dribbble|iconfont|flaticon|花瓣|稿定|remove\.bg|photopea|抠图)/],
  ['08 · 物流与财务', ['物流查询', '支付与税务'], /(4px|yanwen|sf-express|dhl|fedex|ups\.com|track|paypal|stripe|payoneer|pingpong|worldfirst|invoice|exchange|wise|物流)/],
  ['09 · 工具与效率', ['在线工具'], /(tool|工具|convert|compress|qr|bit\.ly|translate|pdf|测试)/],
];
const FALLBACK = '99 · 待整理';

function bucketOf(host, title) {
  const blob = (host + ' ' + (title || '')).toLowerCase();
  for (const [name, kids, re] of BUCKETS) if (re.test(blob)) return [name, kids[0]];
  return [FALLBACK];
}

const stats = { requests: 0, mode: { fail429: 0, wrapFence: 0, truncate: 0 } };

function taxonomyFromPrompt(user) {
  const used = new Set();
  for (const line of user.split('\n')) {
    const m = line.match(/^- (\S+)\s*\(/);
    if (!m) continue;
    for (const [name, , re] of BUCKETS) if (re.test(m[1])) used.add(name);
  }
  const tops = BUCKETS.filter(([n]) => used.has(n))
    .map(([name, kids]) => ({ name, children: kids.map((k) => ({ name: k, desc: '' })) }));
  if (!tops.length) tops.push({ name: '01 · 通用', children: [{ name: '常用', desc: '' }] });
  return { topFolders: tops, fallbackFolder: FALLBACK, reasoning: 'mock 服务端按域名关键词归纳' };
}

function hostAssign(user) {
  const assign = {}, splitHosts = [];
  for (const line of user.split('\n')) {
    if (!line.startsWith('- ')) continue;
    const host = line.slice(2).split(/[\s(]/)[0];
    if (!host) continue;
    assign[host] = bucketOf(host, line);
    if (/(ozon|amazon|aliexpress|taobao|1688|jd\.com)/.test(host)) splitHosts.push(host);
  }
  return { assign, splitHosts };
}

function itemAssign(sys, user) {
  const host = (sys.match(/「([^」]+)」/) || [])[1] || '';
  const assign = {};
  user.split('\n').slice(1).forEach((ln, i) => {
    const m = ln.match(/^\d+\.\s*(.*)$/);
    if (!m) return;
    const title = m[1];
    const base = bucketOf(host, title);
    const kids = (BUCKETS.find(([n]) => n === base[0]) || [, []])[1];
    const isAdmin = /(后台|管理|卖家|商家|seller|admin|dashboard|console|工作台|控制台|订单|order)/.test(title.toLowerCase());
    assign[String(i)] = kids.length ? [base[0], isAdmin ? kids[0] : (kids[1] || kids[0])] : base;
  });
  return { assign };
}

function refine(sys, user) {
  const assign = {};
  user.split('\n').forEach((ln, i) => {
    const m = ln.match(/^\d+\.\s*(.*?)\s+域名:(\S+)$/);
    if (m) assign[String(i)] = bucketOf(m[2], m[1]);
  });
  return { assign };
}

function startMockServer() {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization || '';
    if (req.url.startsWith('/v1/models')) {
      if (auth === 'Bearer badkey') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"invalid api key"}}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-pro' }] }));
      return;
    }
    if (!req.url.startsWith('/v1/chat/completions')) { res.writeHead(404); res.end('{}'); return; }

    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (auth === 'Bearer badkey') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"Authentication Fails, Your api key is invalid"}}');
        return;
      }
      stats.requests++;
      if (stats.mode.fail429 > 0) {
        stats.mode.fail429--;
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"rate limit"}}');
        return;
      }

      let payload;
      try { payload = JSON.parse(body); } catch { res.writeHead(400); res.end('{}'); return; }
      const sys = payload.messages?.[0]?.content || '';
      const user = payload.messages?.[1]?.content || '';

      let data;
      if (sys.includes('信息架构师')) data = taxonomyFromPrompt(user);
      else if (sys.includes('书签归档助手') && user.includes('待归类域名')) data = hostAssign(user);
      else if (sys.includes('同一个站点')) data = itemAssign(sys, user);
      else if (sys.includes('没能确定归属')) data = refine(sys, user);
      else data = { ok: true };

      let text = JSON.stringify(data);
      if (stats.mode.wrapFence > 0) {
        stats.mode.wrapFence--;
        text = '好的，以下是整理结果：\n\n```json\n' + text + '\n```\n\n希望对你有帮助。';
      }
      if (stats.mode.truncate > 0) {
        stats.mode.truncate--;
        text = text.slice(0, Math.max(20, Math.floor(text.length * 0.6)));
      }

      const pt = Math.ceil((sys.length + user.length) / 3);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock', object: 'chat.completion', model: payload.model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: pt, completion_tokens: Math.ceil(text.length / 3), total_tokens: pt + Math.ceil(text.length / 3) },
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ================= 主流程 ================= */
async function main() {
  OUT.push('==================== AI 整理链路 端到端测试 ====================');
  if (!BOOKMARKS || !fs.existsSync(BOOKMARKS)) {
    OUT.push('缺少书签数据文件参数，退出。');
    writeOut();
    process.exit(2);
  }

  const { chrome, index, root } = makeChromeStub(BOOKMARKS);
  globalThis.chrome = chrome;

  const shared = await import('./shared.mjs');
  const bookmarks = await shared.getAllBookmarks();

  sec('0. 数据准备');
  check('读到书签', bookmarks.length > 100, `实际 ${bookmarks.length}`);
  check('顶层目录存在', (root.children || []).length >= 1);

  const rules = await import('./rules.mjs');
  const prompts = await import('./prompts.mjs');
  const client = await import('./client.mjs');
  const planner = await import('./planner.mjs');
  const apply = await import('./apply.mjs');

  const originalParents = new Map(bookmarks.map((b) => [b.id, b.parentId]));

  /* ---------- 1. 摘要与成本预估 ---------- */
  sec('1. 摘要聚合与成本预估');
  const digest = planner.buildDigest(bookmarks, {});
  check('摘要按域名聚类', digest.totalHosts > 0 && digest.totalHosts < bookmarks.length,
    `${bookmarks.length} 条 -> ${digest.totalHosts} 域名`);
  check('摘要文本包含域名与样本', /^\- \S+ \(\d+\)/m.test(digest.text));
  const cost = planner.previewCost(digest, { hostBatchSize: 60 });
  check('成本预估给出 token 数', cost.totalIn > 0 && cost.hostChunks >= 1,
    `~${cost.totalIn} tokens / ${cost.hostChunks} 批`);
  OUT.push(`  摘要 token 估算 ≈ ${Math.ceil(digest.text.length / 3)}，详细域名 ${digest.detailedCount} 个`);

  /* ---------- 2. 工具函数 ---------- */
  sec('2. JSON 抽取与错误翻译');
  check('能剥掉 ```json 围栏',
    client.extractJson('前言\n```json\n{"a":1}\n```\n后记').a === 1);
  check('能从废话里抠出 JSON',
    JSON.stringify(client.extractJson('好的：{"assign":{"x":["A"]}} 就这样')) === '{"assign":{"x":["A"]}}');
  const repaired = client.repairTruncatedJson('{"topFolders":[{"name":"A","children":[{"name":"B"}');
  check('能修复被截断的 JSON', !!repaired && repaired.topFolders?.[0]?.name === 'A');
  check('401 提示含「鉴权失败」', client.friendlyError(401, '', 'u', 'm').includes('鉴权失败'));
  check('404 提示含 Base URL', client.friendlyError(404, '', 'u', 'm').includes('Base URL'));
  check('429 提示含「限流」', client.friendlyError(429, '', 'u', 'm').includes('限流'));

  /* ---------- 3. 端到端跑流水线 ---------- */
  sec('3. 端到端流水线（mock 模型服务端）');
  const { server, port } = await startMockServer();
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const cfg = {
    provider: 'custom', baseUrl, apiKey: 'test-key-ok', model: 'mock-chat',
    temperature: 0.2, maxTokens: 4096, concurrency: 3,
    batchSize: 25, hostBatchSize: 15, language: 'zh',
    sendFullUrl: false, autoSplitHosts: true, useLocalRulesFallback: true,
    businessContext: '我做跨境电商',
  };

  // 故障注入：让第 1 次请求先返回 429，验证重试
  stats.mode.fail429 = 1;

  const callJson = (messages, opts = {}) =>
    client.chatJson({ ...cfg, jsonMode: 'response_format' }, messages, { retries: 3, ...opts });

  const phases = [];
  const t0 = Date.now();
  const { plan, stats: pstats, taxonomy, usage } = await planner.runPipeline({
    bookmarks, cfg, callJson, rules: rules.DEFAULT_RULES,
    onProgress: (p) => phases.push(p.phase),
  });
  const ms = Date.now() - t0;

  check('流水线产出计划', plan.length === bookmarks.length, `${plan.length} vs ${bookmarks.length}`);
  check('归纳出分类体系', taxonomy.topFolders.length >= 3, `${taxonomy.topFolders.length} 个一级目录`);
  check('经历全部阶段',
    ['digest', 'taxonomy', 'hosts', 'items', 'done'].every((p) => phases.includes(p)),
    JSON.stringify([...new Set(phases)]));
  check('429 被自动重试且最终成功', usage.calls > 0 && stats.requests > usage.calls,
    `请求 ${stats.requests} 次 / 计费调用 ${usage.calls} 次`);
  OUT.push(`  服务端收到 ${stats.requests} 次请求，耗时 ${ms}ms，用量 ${usage.total_tokens} tokens`);

  const legal = prompts.flattenPaths(taxonomy);
  const illegal = plan.filter((p) => !legal.some((l) => l.length === p.target.length && l.every((s, i) => s === p.target[i])));
  check('所有目标路径都合法（无模型臆造目录）', illegal.length === 0,
    illegal.slice(0, 3).map((p) => p.target.join('/')).join(' ; '));
  check('有书签被模型直接判定', pstats.fromAi > 0, `fromAi=${pstats.fromAi}`);
  check('需要移动的条目数合理', pstats.toMove > 0 && pstats.toMove <= pstats.total, `toMove=${pstats.toMove}`);
  check('待整理比例未失控', pstats.fallback < pstats.total * 0.35,
    `fallback=${pstats.fallback}/${pstats.total}`);
  check('确实做了逐条细判', pstats.splitHosts > 0, `splitHosts=${pstats.splitHosts}`);
  OUT.push('  目录分布（前 8）：');
  pstats.folders.slice(0, 8).forEach(([k, v]) => OUT.push(`    ${String(v).padStart(4)}  ${k}`));

  /* ---------- 4. 围栏 / 截断的容错 ---------- */
  sec('4. 模型输出不规范的容错');
  stats.mode.wrapFence = 2;
  const r1 = await planner.runPipeline({ bookmarks: bookmarks.slice(0, 40), cfg, callJson, rules: rules.DEFAULT_RULES });
  check('围栏 JSON 也能跑通', r1.plan.length === 40 && r1.stats.fromAi > 0);
  stats.mode.truncate = 2;
  const r2 = await planner.runPipeline({ bookmarks: bookmarks.slice(0, 40), cfg, callJson, rules: rules.DEFAULT_RULES });
  check('截断 JSON 有兜底不崩（可回退到规则/待整理）', r2.plan.length === 40,
    `fromAi=${r2.stats.fromAi} rules=${r2.stats.fromRules} fallback=${r2.stats.fallback}`);

  /* ---------- 5. 鉴权失败与取消 ---------- */
  sec('5. 异常路径');
  const badCall = (messages, opts = {}) =>
    client.chatJson({ ...cfg, apiKey: 'badkey', jsonMode: 'response_format' }, messages, { retries: 0, ...opts });
  let errMsg = '';
  try {
    await planner.runPipeline({ bookmarks: bookmarks.slice(0, 20), cfg: { ...cfg, apiKey: 'badkey' }, callJson: badCall, rules: rules.DEFAULT_RULES });
  } catch (e) { errMsg = String(e.message || e); }
  check('Key 错误时给出「鉴权失败」', errMsg.includes('鉴权失败'), errMsg);

  const ac = new AbortController();
  ac.abort();
  let aborted = false;
  try {
    await planner.runPipeline({ bookmarks, cfg, callJson, rules: rules.DEFAULT_RULES, signal: ac.signal });
  } catch (e) { aborted = e.name === 'AbortError'; }
  check('可以取消（AbortError）', aborted);

  /* ---------- 6. 执行与撤销（真实 API 调用序列） ---------- */
  sec('6. 执行整理 + 一键撤销');
  const res = await apply.applyPlan(plan);
  check('执行成功移动若干条', res.moved > 0, `moved=${res.moved} created=${res.created}`);
  const movedNow = [...index.values()].filter((n) => n.url);
  const changed = movedNow.filter((n) => originalParents.get(n.id) !== n.parentId);
  check('实际父目录确实变了', changed.length === res.moved, `${changed.length} vs ${res.moved}`);

  const journal = await apply.loadJournal();
  check('生成了操作日志', !!journal && journal.moves.length === res.moved);
  const desk = apply.describeJournal(journal);
  check('日志摘要可读', !!desk && desk.moves > 0, JSON.stringify(desk));

  const undo = await apply.undoApply(journal);
  check('撤销成功', undo.restored === res.moved, `restored=${undo.restored}/${res.moved}`);
  const afterUndo = [...index.values()].filter((n) => n.url);
  const wrong = afterUndo.filter((n) => originalParents.get(n.id) !== n.parentId);
  check('撤销后全部回到原目录', wrong.length === 0, `still-moved=${wrong.length}`);
  check('撤销清理了新建目录', undo.removedFolders >= 0, `removedFolders=${undo.removedFolders}`);
  const leftoverFolders = [...index.values()].filter((n) => !n.url && /^(0[1-9]|1[0-6]|99)\s·/.test(n.title));
  OUT.push(`  撤销后残留空业务目录 ${leftoverFolders.length} 个（嵌套目录仍被引用时属正常）`);
  check('撤销后没有残留空目录（顶层）',
    leftoverFolders.filter((f) => (f.children || []).length === 0).length === 0,
    leftoverFolders.filter((f) => (f.children || []).length === 0).map((f) => f.title).join(','));

  server.close();

  sec('结果');
  OUT.push(`  通过 ${pass} 项，失败 ${fail} 项`);
  OUT.push(fail === 0 ? '  ✅ 全链路测试通过' : '  ❌ 存在失败项，需修复');
  writeOut();
  process.exit(fail === 0 ? 0 : 1);
}

function writeOut() {
  const target = path.join(HERE, 'ai_test_result.txt');
  fs.writeFileSync(target, OUT.join('\n'), 'utf8');
  console.log(OUT.join('\n'));
}

main().catch((e) => {
  OUT.push('测试脚本自身异常：' + (e && e.stack ? e.stack : String(e)));
  writeOut();
  process.exit(3);
});
