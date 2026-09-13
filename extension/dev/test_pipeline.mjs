/**
 * test_pipeline.mjs —— 用真实收藏夹数据驱动扩展核心模块，验证数据管道
 *
 * 覆盖：getAllBookmarks / computeStats / classify / findDuplicates
 *       findImportFolders / findBlankTitles
 * 分别跑「整理前的原始数据」和「整理后的干净数据」，两边结果都要符合预期。
 */
import { readFileSync } from 'fs';

const W = 'C:/Users/yangzhiheng/WorkBuddy/2026-09-13-22-18-54/bookmarks_work';

/* ---- 用真实 Bookmarks JSON 造出 chrome.bookmarks.getTree() 形状 ----
   Chromium 的 Bookmarks 文件用 name/date_added，而 bookmarks API 返回 title/dateAdded，
   这里必须递归转换，否则深层节点会全部变成无标题。 */
function loadTree(file) {
  const data = JSON.parse(readFileSync(`${W}/${file}`, 'utf8'));

  function conv(n, parentId) {
    const o = {
      id: n.id,
      parentId,
      title: n.name || '',
      dateAdded: Number(n.date_added || 0),
    };
    if (n.type === 'url' || n.url) {
      o.url = n.url;
    } else {
      o.children = (n.children || []).map((c) => conv(c, n.id));
    }
    return o;
  }

  const root = { id: '0', title: '', children: [] };
  for (const k of ['bookmark_bar', 'other', 'synced']) {
    const n = data.roots[k];
    root.children.push(conv(n, '0'));
  }
  return root;
}

function installChromeStub(tree) {
  const index = new Map();
  (function walk(n) { index.set(n.id, n); (n.children || []).forEach(walk); })(tree);
  const clone = (n) => JSON.parse(JSON.stringify(n));
  globalThis.chrome = {
    runtime: { getURL: () => '', id: 'test' },
    bookmarks: {
      getTree: async () => [clone(tree)],
      getChildren: async (id) => ((index.get(id) || {}).children || []).map(clone),
      get: async (id) => [clone(index.get(id))],
      create: async () => ({}), move: async () => ({}),
      remove: async () => {}, removeTree: async () => {}, update: async () => ({}),
    },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  };
}

const { getAllBookmarks, computeStats, cleanTitle } = await import('./shared.mjs');
const { classify, DEFAULT_RULES, UNCLASSIFIED } = await import('./rules.mjs');
const { findDuplicates, findImportFolders, findBlankTitles } = await import('./tidy.mjs');

async function run(label, file, expect) {
  console.log('\n' + '='.repeat(64));
  console.log(`场景：${label}  (${file})`);
  console.log('='.repeat(64));

  installChromeStub(loadTree(file));

  const all = await getAllBookmarks();
  const st = computeStats(all, {});
  const dups = findDuplicates(all);
  const imports = await findImportFolders();
  const blanks = findBlankTitles(all);
  // 标题里含零宽/格式控制字符（真正的病根，浏览器里会显示异常）
  const zwCount = all.filter((b) =>
    /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]/.test(b.rawTitle || '')
  ).length;

  let unclassified = 0;
  const hits = {};
  for (const b of all) {
    const t = classify(b, DEFAULT_RULES).join(' / ');
    if (t === UNCLASSIFIED.join(' / ')) unclassified++;
    hits[t] = (hits[t] || 0) + 1;
  }

  const rows = [
    ['书签总数', all.length, expect.total],
    ['唯一网址', st.unique, expect.unique],
    ['重复组数', dups.length, expect.dupGroups],
    ['重复冗余条数', st.dupItems, expect.dupItems],
    ['导入残留文件夹', imports.length, expect.imports],
    ['零宽字符污染标题', zwCount, expect.zw],
    ['真正完全空白标题', blanks.length, expect.blanks],
    ['收藏栏顶层散落', st.looseOnBar, expect.loose],
    ['未归类(去扩展规则)', unclassified, expect.unclassified],
  ];

  let pass = true;
  for (const [name, got, want] of rows) {
    const ok = want === null || got === want;
    if (!ok) pass = false;
    const exp = want === null ? '(不校验)' : `期望 ${want}`;
    console.log(`  ${ok ? '[OK]  ' : '[FAIL]'} ${name.padEnd(22)} 实际 ${String(got).padStart(5)}   ${exp}`);
  }

  console.log('  --- 分类命中最多的目标 ---');
  Object.entries(hits).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .forEach(([k, v]) => console.log(`        ${String(v).padStart(4)}  ${k}`));

  if (imports.length) {
    console.log('  --- 检出的导入残留文件夹 ---');
    imports.forEach((f) => console.log(`        ${f.path.join(' / ')}`));
  }
  if (dups.length) {
    console.log('  --- 重复最严重的前 3 组 ---');
    dups.slice(0, 3).forEach((g) => console.log(`        x${g.items.length}  ${g.items[0].title}`));
  }

  return pass;
}

let allPass = true;
allPass = await run('整理前（真实原始数据）', 'Bookmarks.original.json', {
  total: 778, unique: 386, dupGroups: 151, dupItems: 392,
  imports: 4, zw: 30, blanks: 0, loose: 166, unclassified: null,
}) && allPass;

allPass = await run('整理后（将要安装的数据）', 'Bookmarks.cleaned.json', {
  total: 386, unique: 386, dupGroups: 0, dupItems: 0,
  imports: 0, zw: 0, blanks: 0, loose: 0, unclassified: 1,
}) && allPass;

console.log('\n' + '='.repeat(64));
console.log(allPass ? '全部通过 ✔' : '存在未通过项 ✘');
console.log('='.repeat(64));
process.exit(allPass ? 0 : 1);
