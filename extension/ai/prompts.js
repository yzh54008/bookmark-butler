/**
 * ai/prompts.js — 提示词
 *
 * 分三阶段，而不是「把几百条书签丢给模型让它一次分完」：
 *   A. 归纳体系：只看聚合摘要（域名 + 条数 + 标题样本），产出一套分类骨架
 *   B. 域名分派：给定骨架，把每个域名指到一条路径上（书签数量由此骤减到几十个决策）
 *   C. 逐条细判：只针对「一个域名多用途」的情况（如 ozon.ru 既有后台又有类目页），
 *      才逐条判断——这一步是质量的关键，也是省 token 的关键。
 */

const SCHEMA_HINT = `严格输出 JSON，不要输出任何解释文字、不要用 Markdown 围栏。
路径一律用「数组」表示，例如 ["01 · 电商运营","卖家后台"]。
一级目录名以两位序号开头（"01 · "、"02 · "…），二级目录不加序号。`;

function langLine(lang) {
  return lang === 'en'
    ? 'Folder names must be in English.'
    : '目录名一律用简体中文。';
}

/** ---------- A. 归纳分类体系 ---------- */

export function taxonomyMessages(digest, cfg, existingTops = []) {
  const keepLine = cfg.keepExistingTops && existingTops.length
    ? `用户希望尽量沿用这些已有的顶层目录名（可增删合并，但能留则留）：${JSON.stringify(existingTops)}。`
    : '';

  const system = `你是一位资深的信息架构师（Information Architect），擅长把一个人杂乱的书签整理成「他用起来顺手」的目录体系。
你的任务：根据用户书签的聚合摘要，归纳出一套贴合他真实工作与生活的两层分类体系。

要求：
1. 一级目录 6~14 个，覆盖摘要里出现的绝大多数网站；宁少勿多，避免出现只有 1~2 条的孤立目录。
2. 每个一级目录下给 0~5 个二级目录；不必要时可以只给一级。
3. 命名要具体、可检索，避免「其他」「杂项」这类无信息量的名字（保留一个兜底目录即可）。
4. ${langLine(cfg.language)}
5. 目录名控制在 10 个字以内。
6. 判断依据是摘要里的域名、标题样本和「当前所在目录」，不要凭想象添加用户没有的领域。
7. 如果用户给了业务背景，分类要围绕他的业务展开，而不是通用互联网分类。
${keepLine}
${SCHEMA_HINT}

输出结构：
{
  "topFolders": [
    { "name": "01 · 电商运营", "children": [ { "name": "卖家后台", "desc": "后台与数据看板" } ] }
  ],
  "fallbackFolder": "99 · 待整理",
  "reasoning": "一句话说明你的划分逻辑（不超过 60 字）"
}`;

  const user = `请先看这份书签聚合摘要，再归纳分类体系。

${digest.text}

--- 统计 ---
书签总数：${digest.totalBookmarks}
不同域名：${digest.totalHosts}
${cfg.businessContext ? `\n用户自述的业务背景：${cfg.businessContext}` : ''}
${existingTops.length ? `\n用户当前已有的顶层目录：${JSON.stringify(existingTops)}` : ''}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** ---------- B. 域名分派 ---------- */

export function hostAssignMessages(hostChunk, taxonomy, cfg, existingTops = []) {
  const paths = flattenPaths(taxonomy);
  const system = `你是书签归档助手。给定一套已确定的目录体系，为每个域名指定唯一归属路径。

必须遵守：
1. 只能使用下面列出的合法路径，不要发明新目录。
2. 每个输入域名都必须出现在输出里，一个都不能漏。
3. 如果这个域名的用途无法判断，或明显不属于任何一类，归到 "${taxonomy.fallbackFolder || '99 · 待整理'}"。
4. 如果同一个域名下的书签用途差异很大（例如一个站点既有卖家后台又有面向消费者的商品页），
   把它放进 "splitHosts" 数组，表示需要后续逐条判断；同时仍要在 assign 里给一个默认归属。
5. 判断遇到困难时，优先看标题样本，其次才是域名本身。
${SCHEMA_HINT}

合法路径清单：
${paths.map((p) => JSON.stringify(p)).join('\n')}

输出结构：
{
  "assign": { "example.com": ["01 · 电商运营","卖家后台"] },
  "splitHosts": ["example.com"],
  "notes": "可选，简述难以判断的域名"
}`;

  const list = hostChunk
    .map((h) => {
      const cur = h.currentTop ? `  [现:${h.currentTop}]` : '';
      return `- ${h.host}  (${h.count} 条)${cur}\n    样本: ${h.samples.join(' | ')}`;
    })
    .join('\n');

  const user = `${cfg.businessContext ? `用户业务背景：${cfg.businessContext}\n\n` : ''}待归类域名（共 ${hostChunk.length} 个）：

${list}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** ---------- C. 逐条细判（一域名多用途） ---------- */

export function itemAssignMessages(items, taxonomy, cfg, host) {
  const paths = flattenPaths(taxonomy);
  const system = `你是书签归档助手。下面这些书签来自同一个站点「${host}」，但用途不同，需要逐条判断。
${cfg.sendFullUrl ? '' : '注意：出于隐私，这里没有提供 URL，请主要依据标题判断。'}

必须遵守：
1. 只能使用下面列出的合法路径。
2. 每一条都必须出现在输出里，用它的 index 作为键。
3. 判断不了就归到 "${taxonomy.fallbackFolder || '99 · 待整理'}"，不要硬猜。
4. 标题里出现「后台 / 管理 / 卖家 / seller / admin / dashboard」等词的通常是后台；
   出现具体类目、型号、关键词的通常是前台页面或选品素材。
${SCHEMA_HINT}

合法路径清单：
${paths.map((p) => JSON.stringify(p)).join('\n')}

输出结构：
{ "assign": { "0": ["01 · 电商运营","卖家后台"], "1": ["01 · 电商运营","类目与选品"] } }`;

  const list = items
    .map((it, i) => `${i}. ${cfg.sendFullUrl ? it.title + '  <' + it.url + '>' : it.title}`)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: `书签列表（index. 标题）：\n${list}` },
  ];
}

/** ---------- D. 兜底复核 ---------- */

export function refineMessages(items, taxonomy, cfg) {
  const paths = flattenPaths(taxonomy);
  return [
    {
      role: 'system',
      content: `你是书签归档助手。下面这些书签在第一次归类时没能确定归属，请再努力一次。
允许使用的路径：
${paths.map((p) => JSON.stringify(p)).join('\n')}

如果确实无法判断，就保留 "${taxonomy.fallbackFolder || '99 · 待整理'}"。
${SCHEMA_HINT}

输出结构：{ "assign": { "3": ["01 · 电商运营","卖家后台"] } }`,
    },
    {
      role: 'user',
      content: items
        .map((it, i) => `${i}. ${it.title}${cfg.sendFullUrl ? '  <' + it.url + '>' : ''}  域名:${it.host}`)
        .join('\n'),
    },
  ];
}

/** 把 taxonomy 展开成所有合法路径（含一级单层的） */
export function flattenPaths(taxonomy) {
  const out = [];
  const fallback = taxonomy?.fallbackFolder || '99 · 待整理';
  for (const t of taxonomy?.topFolders || []) {
    if (!t?.name) continue;
    out.push([t.name]);
    for (const c of t.children || []) {
      if (c?.name) out.push([t.name, c.name]);
    }
  }
  if (!out.some((p) => p[0] === fallback)) out.push([fallback]);
  return out;
}

/** 用于 UI 展示的纯文本摘要 */
export function digestToText(digest) {
  return digest.text;
}
