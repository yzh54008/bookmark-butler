/**
 * test_rules.mjs — 用真实收藏夹数据验证分类规则覆盖率
 * 运行：node test_rules.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { DEFAULT_RULES, classify, validateRules, UNCLASSIFIED } from './rules.js';

const W = 'C:/Users/yangzhiheng/WorkBuddy/2026-09-13-22-18-54/bookmarks_work';
const unique = JSON.parse(readFileSync(`${W}/unique.json`, 'utf8'));

// unique.json 是 {normalized: {name, url, path}}
const list = Object.values(unique).map((v) => ({
  title: v.name,
  rawTitle: v.name,
  url: v.url,
  path: v.path,
}));

console.log('='.repeat(66));
console.log('规则体检');
console.log('='.repeat(66));
const problems = validateRules(DEFAULT_RULES);
console.log(problems.length ? problems.join('\n') : '  规则结构检查通过');

const hits = {};
const unmatched = [];
for (const b of list) {
  const t = classify(b, DEFAULT_RULES).join(' / ');
  hits[t] = (hits[t] || 0) + 1;
  if (t === UNCLASSIFIED.join(' / ')) unmatched.push(b);
}

console.log('');
console.log(`样本总数: ${list.length}`);
console.log(`已归类  : ${list.length - unmatched.length}`);
console.log(`未归类  : ${unmatched.length}`);
console.log('');
console.log('各目标文件夹命中数：');
for (const [k, v] of Object.entries(hits).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

if (unmatched.length) {
  console.log('');
  console.log('未归类明细：');
  for (const b of unmatched) {
    let h = '';
    try { h = new URL(b.url).hostname; } catch {}
    console.log(`  ${(b.title || '').slice(0, 40).padEnd(42)} | ${h}`);
  }
}
console.log('='.repeat(66));
