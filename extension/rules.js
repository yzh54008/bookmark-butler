/**
 * rules.js — 分类规则引擎
 *
 * 规则完全数据化，可在「管理台 → 规则」里直接改，不用改代码。
 * classify() 返回目标文件夹路径数组，例如 ['01 · OZON 运营', '卖家后台']。
 * 命中顺序：内网 → OZON 主站特判 → 域名精确表 → 平台白名单 → 关键词兜底 → 未分类
 */

export const UNCLASSIFIED = ['99 · 待整理'];

export const DEFAULT_RULES = {
  version: 1,

  /** 一级业务域（顺序即目录顺序） */
  topFolders: [
    '01 · OZON 运营',
    '02 · ERP 与选品',
    '03 · 货源与采购',
    '04 · 物流与海外仓',
    '05 · 支付与财税',
    '06 · 独立站与域名',
    '07 · AI 工具与自动化',
    '08 · 云服务与开发',
    '09 · 学习资料',
    '10 · 商务与政务',
    '11 · 素材工具箱',
    '12 · 社媒与内容',
    '13 · 自有服务与内网',
  ],

  /** 域名 -> [一级, 二级?]。键为主机名（已去 www），支持带端口 */
  domainMap: {
    'seller.ozon.ru': ['01 · OZON 运营', '卖家后台'],
    'docs.ozon.ru': ['01 · OZON 运营', '规则与学习'],
    'ozon.wiki': ['01 · OZON 运营', '规则与学习'],

    'erp.91miaoshou.com': ['02 · ERP 与选品', 'ERP 系统'],
    'ozon.maozierp.com': ['02 · ERP 与选品', 'ERP 系统'],
    'bdmozon.com': ['02 · ERP 与选品', 'ERP 系统'],
    'ozon.xingfandu.com': ['02 · ERP 与选品', 'ERP 系统'],
    'vicserp.com': ['02 · ERP 与选品', 'ERP 系统'],
    'dianxiaomi.com': ['02 · ERP 与选品', 'ERP 系统'],
    'damao.shanshangnet.com': ['02 · ERP 与选品', 'ERP 系统'],
    'luotuoerp.cn': ['02 · ERP 与选品', 'ERP 系统'],
    'my.jizhangerp.com': ['02 · ERP 与选品', 'ERP 系统'],
    'myozoncs.com': ['02 · ERP 与选品', 'ERP 系统'],
    'genmaijl.com': ['02 · ERP 与选品', 'ERP 系统'],
    'shopbang.cn': ['02 · ERP 与选品', 'ERP 系统'],
    'shunshun-erp.oem.niubeiapp.com': ['02 · ERP 与选品', 'ERP 系统'],
    'scc.litb.cn': ['02 · ERP 与选品', 'ERP 系统'],

    'ozon.menglar.com': ['02 · ERP 与选品', '选品与数据'],
    'seerfar.cn': ['02 · ERP 与选品', '选品与数据'],
    'ozon.kwoniu.com': ['02 · ERP 与选品', '选品与数据'],
    'geekozon.cn': ['02 · ERP 与选品', '选品与数据'],
    'kuajing84.com': ['02 · ERP 与选品', '选品与数据'],
    'linkfox.com': ['02 · ERP 与选品', '选品与数据'],
    'sdsdiy.com': ['02 · ERP 与选品', '选品与数据'],
    'zh.accio.com': ['02 · ERP 与选品', '选品与数据'],
    'wordstat.yandex.com': ['02 · ERP 与选品', '选品与数据'],

    'ru-wulaer-console.ztocwst.com': ['04 · 物流与海外仓'],
    'ru-wulaer-console.ztocwstcrossborder.com': ['04 · 物流与海外仓'],
    'tmsplus.ilinexpress.com': ['04 · 物流与海外仓'],
    'tms.celdt.cn': ['04 · 物流与海外仓'],
    'jcex.com': ['04 · 物流与海外仓'],
    'dhl.com': ['04 · 物流与海外仓'],
    'ups.com': ['04 · 物流与海外仓'],
    'gdeposylka.ru': ['04 · 物流与海外仓'],
    'szdpxx.cn': ['04 · 物流与海外仓'],
    'seller.unitrade.space': ['04 · 物流与海外仓'],
    'sellerdev.unitrade.space': ['04 · 物流与海外仓'],
    'unitrade-global.com': ['04 · 物流与海外仓'],

    'airwallex.com': ['05 · 支付与财税'],
    'portal.worldfirst.com.cn': ['05 · 支付与财税'],
    'cn.lianlianpay.com': ['05 · 支付与财税'],
    'global.lianlianpay.com': ['05 · 支付与财税'],
    'paypal.cn': ['05 · 支付与财税'],
    'netc1.igtb.bankofchina.com': ['05 · 支付与财税'],
    'etax.jiangsu.chinatax.gov.cn': ['05 · 支付与财税'],
    'tpass.jiangsu.chinatax.gov.cn': ['05 · 支付与财税'],
    'shanghai.chinatax.gov.cn': ['05 · 支付与财税'],
    'etax.shanghai.chinatax.gov.cn': ['05 · 支付与财税'],

    'admin.shopify.com': ['06 · 独立站与域名'],
    'wanwang.aliyun.com': ['06 · 独立站与域名'],
    'dc.console.aliyun.com': ['06 · 独立站与域名'],
    'sharpseam.com': ['06 · 独立站与域名'],
    'indochino.com': ['06 · 独立站与域名'],
    'azazie.com': ['06 · 独立站与域名'],

    'chat.deepseek.com': ['07 · AI 工具与自动化', '对话与模型'],
    'platform.deepseek.com': ['07 · AI 工具与自动化', '对话与模型'],
    'chatglm.cn': ['07 · AI 工具与自动化', '对话与模型'],
    'kimi.moonshot.cn': ['07 · AI 工具与自动化', '对话与模型'],
    'metaso.cn': ['07 · AI 工具与自动化', '对话与模型'],
    'so.360.com': ['07 · AI 工具与自动化', '对话与模型'],
    'chatgpt.com': ['07 · AI 工具与自动化', '对话与模型'],
    'openrouter.ai': ['07 · AI 工具与自动化', '对话与模型'],
    'ofox.ai': ['07 · AI 工具与自动化', '对话与模型'],
    'shiyunapi.com': ['07 · AI 工具与自动化', '对话与模型'],
    'platform.xiaomimimo.com': ['07 · AI 工具与自动化', '对话与模型'],
    'bailian.console.aliyun.com': ['07 · AI 工具与自动化', '对话与模型'],
    'aistudio.yandex.ru': ['07 · AI 工具与自动化', '对话与模型'],
    'doubao.com': ['07 · AI 工具与自动化', '对话与模型'],

    'jimeng.jianying.com': ['07 · AI 工具与自动化', '图像与设计'],
    'liblib.art': ['07 · AI 工具与自动化', '图像与设计'],
    'pictech.cc': ['07 · AI 工具与自动化', '图像与设计'],
    'nanobanana.co': ['07 · AI 工具与自动化', '图像与设计'],
    'tongyi.aliyun.com': ['07 · AI 工具与自动化', '图像与设计'],
    'canva.cn': ['07 · AI 工具与自动化', '图像与设计'],
    'yiketu.com': ['07 · AI 工具与自动化', '图像与设计'],
    'remove.bg': ['07 · AI 工具与自动化', '图像与设计'],
    'ai-bot.cn': ['07 · AI 工具与自动化', '图像与设计'],
    'ai.yanqueai.com': ['07 · AI 工具与自动化', '图像与设计'],
    'app.klingai.com': ['07 · AI 工具与自动化', '图像与设计'],
    'jiandan.link': ['07 · AI 工具与自动化', '图像与设计'],
    'kt.94xy.com': ['07 · AI 工具与自动化', '图像与设计'],
    'm.gaoding.com': ['07 · AI 工具与自动化', '图像与设计'],
    'ps.gaoding.com': ['07 · AI 工具与自动化', '图像与设计'],
    'magiceraser.pro': ['07 · AI 工具与自动化', '图像与设计'],
    'remove.photos': ['07 · AI 工具与自动化', '图像与设计'],
    'tinywow.com': ['07 · AI 工具与自动化', '图像与设计'],
    'recraft.ai': ['07 · AI 工具与自动化', '图像与设计'],
    'roboneo.com': ['07 · AI 工具与自动化', '图像与设计'],
    'zh.bgsub.com': ['07 · AI 工具与自动化', '图像与设计'],
    'anywebp.com': ['07 · AI 工具与自动化', '图像与设计'],
    'products.aspose.app': ['07 · AI 工具与自动化', '图像与设计'],
    'cn.jollytoday.com': ['07 · AI 工具与自动化', '图像与设计'],
    'wangdaozi.com': ['07 · AI 工具与自动化', '图像与设计'],

    'coze.cn': ['07 · AI 工具与自动化', '自动化平台'],
    'dify.ai': ['07 · AI 工具与自动化', '自动化平台'],
    'make.com': ['07 · AI 工具与自动化', '自动化平台'],
    'yingdao.com': ['07 · AI 工具与自动化', '自动化平台'],
    'cocoloop.cn': ['07 · AI 工具与自动化', '自动化平台'],
    'hub.cocoloop.cn': ['07 · AI 工具与自动化', '自动化平台'],

    'github.com': ['08 · 云服务与开发'],
    'dash.cloudflare.com': ['08 · 云服务与开发'],
    'qiniu.com': ['08 · 云服务与开发'],
    'cloud.tencent.com': ['08 · 云服务与开发'],
    'my.heiying.org': ['08 · 云服务与开发'],
    'mojie.uk': ['08 · 云服务与开发'],
    'mojie.co': ['08 · 云服务与开发'],
    'help.viewturbo.com': ['08 · 云服务与开发'],

    'bzfree.com': ['09 · 学习资料'],
    'docs.qq.com': ['09 · 学习资料'],
    'kdocs.cn': ['09 · 学习资料'],
    'phet.colorado.edu': ['09 · 学习资料'],

    'zhipin.com': ['10 · 商务与政务'],
    'zhaopin.com': ['10 · 商务与政务'],
    'freelancer.com': ['10 · 商务与政务'],
    'upwork.com': ['10 · 商务与政务'],
    'wcjs.sbj.cnipa.gov.cn': ['10 · 商务与政务'],
    'sso.cnipa.gov.cn': ['10 · 商务与政务'],
    'beian.mps.gov.cn': ['10 · 商务与政务'],
    'tsm.miit.gov.cn': ['10 · 商务与政务'],
    'scjg.jszwfw.gov.cn': ['10 · 商务与政务'],
    'jszwfw.gov.cn': ['10 · 商务与政务'],
    'jszwfw.gjzwfw.gov.cn': ['10 · 商务与政务'],
    'zwdt.sh.gov.cn': ['10 · 商务与政务'],
    'yct.sh.gov.cn': ['10 · 商务与政务'],
    'singlewindow.cn': ['10 · 商务与政务'],
    'swapp.singlewindow.cn': ['10 · 商务与政务'],
    'mail.google.com': ['10 · 商务与政务'],
    'mail.qq.com': ['10 · 商务与政务'],
    'outlook.live.com': ['10 · 商务与政务'],
    'jscopyright.cn': ['10 · 商务与政务'],
    'shbqdj.cn': ['10 · 商务与政务'],

    'feiyudo.com': ['11 · 素材工具箱'],
    'datatool.vip': ['11 · 素材工具箱'],
    'aconvert.com': ['11 · 素材工具箱'],
    'panmeme.com': ['11 · 素材工具箱'],
    'postimages.org': ['11 · 素材工具箱'],
    'excalidraw.com': ['11 · 素材工具箱'],
    'js.design': ['11 · 素材工具箱'],
    'w3ctool.com': ['11 · 素材工具箱'],
    'translate.yandex.com': ['11 · 素材工具箱'],
    'translate.yandex.ru': ['11 · 素材工具箱'],
    '58pic.com': ['11 · 素材工具箱'],
    'emojiall.com': ['11 · 素材工具箱'],
    'ruancang.net': ['11 · 素材工具箱'],
    'pan.baidu.com': ['11 · 素材工具箱'],
    'map.baidu.com': ['11 · 素材工具箱'],
    'baidu.com': ['11 · 素材工具箱'],
    'bd.ykdfr.com': ['11 · 素材工具箱'],
    'bing.com': ['11 · 素材工具箱'],
    'grizzlysms.com': ['11 · 素材工具箱'],

    'bilibili.com': ['12 · 社媒与内容'],
    'douyin.com': ['12 · 社媒与内容'],
    'creator.douyin.com': ['12 · 社媒与内容'],
    'life.douyin.com': ['12 · 社媒与内容'],
    'xiaohongshu.com': ['12 · 社媒与内容'],
    'zhihu.com': ['12 · 社媒与内容'],
    'fxg.jinritemai.com': ['12 · 社媒与内容'],

    'a.beizijinfu.com': ['13 · 自有服务与内网'],

    // 货源与采购 · 电商货源（1688 系批发/一件代发货源站）
    '168dmj.com': ['03 · 货源与采购', '电商货源'],
    '1688.com': ['03 · 货源与采购', '电商货源'],
    'sooxie.com': ['03 · 货源与采购', '电商货源'],
    '17mjf.com': ['03 · 货源与采购', '电商货源'],
    'bao66.cn': ['03 · 货源与采购', '电商货源'],
    'hznzcn.com': ['03 · 货源与采购', '电商货源'],
    'k3.cn': ['03 · 货源与采购', '电商货源'],
    'mmgg.com': ['03 · 货源与采购', '电商货源'],
    'rongqu.net': ['03 · 货源与采购', '电商货源'],
    'wlys.cn': ['03 · 货源与采购', '电商货源'],
    'xingfujie.cn': ['03 · 货源与采购', '电商货源'],
    'yunchepin.cn': ['03 · 货源与采购', '电商货源'],
    'zhaojiafang.com': ['03 · 货源与采购', '电商货源'],
    'babyzhiai.net': ['03 · 货源与采购', '电商货源'],
    'shop.boqii.com': ['03 · 货源与采购', '电商货源'],
    'b2b.fulu.com': ['03 · 货源与采购', '电商货源'],
    'dianleida.net': ['03 · 货源与采购', '电商货源'],
    'yunqishuju.com': ['03 · 货源与采购', '电商货源'],
    'ozonbigsell.com': ['03 · 货源与采购', '电商货源'],
    'bcsozon.com': ['03 · 货源与采购', '电商货源'],
    'partnershare.cn': ['03 · 货源与采购', '电商货源'],
    '32cd.com': ['03 · 货源与采购', '电商货源'],
    'mobile.yangkeduo.com': ['03 · 货源与采购', '电商货源'],
    '51selling.com': ['03 · 货源与采购', '电商货源'],

    // 货源与采购 · 电子元器件
    'dzsc.com': ['03 · 货源与采购', '电子元器件'],
    'hqchip.com': ['03 · 货源与采购', '电子元器件'],
    'hqew.com': ['03 · 货源与采购', '电子元器件'],
    'ichunt.com': ['03 · 货源与采购', '电子元器件'],
    'ickey.cn': ['03 · 货源与采购', '电子元器件'],
    'szlcsc.com': ['03 · 货源与采购', '电子元器件'],
  },

  /** 域名后缀匹配（用于 *.feishu.cn 这类多实例域名） */
  hostSuffixMap: [
    { suffix: 'feishu.cn', target: ['09 · 学习资料'] },
    { suffix: 'larkoffice.com', target: ['09 · 学习资料'] },
    { suffix: 'larksuite.com', target: ['09 · 学习资料'] },
    { suffix: 'stagcraft.com', target: ['13 · 自有服务与内网'] },
  ],

  /** 判定为「自有服务与内网」的主机 */
  internalHosts: ['localhost', '127.0.0.1', '::1'],
  internalSuffixes: ['stagcraft.com'],

  /** OZON 主站识别：命中则按 title 关键字分流到 店铺库 / 类目页 */
  primarySites: ['ozon.ru'],
  shopTitleKeywords: ['официальн', 'официальный', '官方网店', '商品目录', 'каталог'],
  shopPathKeywords: ['好店铺', '店铺'],
  categoryFolderName: '前台类目页',
  shopFolderName: '官方店铺库',

  /** 其他平台（归入 01 · OZON 运营 / 其他平台） */
  otherPlatforms: [
    'wildberries.ru',
    'yandex.com',
    'wap.yandex.com',
    'market.yandex.ru',
    'partner.market.yandex.ru',
    'seller.shopee.cn',
  ],
  otherPlatformFolder: '其他平台',

  /** 关键词兜底（域名表未命中时） */
  keywords: [
    { words: ['货源', '批发', '一件代发', '网批', '网供', '供货', '分销', '代发'], target: ['03 · 货源与采购', '电商货源'] },
    { words: ['电子元器件', '元器件', 'bom配单', 'smt贴片', 'pcb打样'], target: ['03 · 货源与采购', '电子元器件'] },
    { words: ['抠图', '背景移除', '去除背景', '图片处理', '图库', '素材网', '设计素材'], target: ['07 · AI 工具与自动化', '图像与设计'] },
    { words: ['物流', '快递', '轨迹查询', '海外仓', '报关', '国际货运'], target: ['04 · 物流与海外仓'] },
    { words: ['著作权', '知识产权', '政务服务', '电子税务'], target: ['10 · 商务与政务'] },
  ],
};

/** 核心分类函数 */
export function classify(bm, rules = DEFAULT_RULES) {
  const url = bm.url || '';
  let host = '';
  let hostWithPort = '';
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./i, '').toLowerCase();
    hostWithPort = u.host.toLowerCase();
  } catch {
    return UNCLASSIFIED;
  }

  // 1) 内网 / 自有服务
  const bareHost = host.split(':')[0];
  if (
    rules.internalHosts.includes(hostWithPort) ||
    rules.internalHosts.includes(bareHost) ||
    rules.internalSuffixes.some((s) => host.endsWith(s)) ||
    /^10\./.test(bareHost) ||
    /^192\.168\./.test(bareHost) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(bareHost) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(bareHost)
  ) {
    return ['13 · 自有服务与内网'];
  }

  // 2) 主站（OZON）细分
  if (rules.primarySites.includes(host)) {
    const title = (bm.title || bm.rawTitle || '').toLowerCase();
    const pathStr = (bm.path || []).join('/');
    if (
      rules.shopTitleKeywords.some((k) => title.includes(k.toLowerCase())) ||
      rules.shopPathKeywords.some((k) => pathStr.includes(k))
    ) {
      return ['01 · OZON 运营', rules.shopFolderName];
    }
    return ['01 · OZON 运营', rules.categoryFolderName];
  }

  // 3) 其他平台
  if (rules.otherPlatforms.includes(host)) {
    return ['01 · OZON 运营', rules.otherPlatformFolder];
  }

  // 4) 域名精确表
  if (rules.domainMap[hostWithPort]) return [...rules.domainMap[hostWithPort]];
  if (rules.domainMap[host]) return [...rules.domainMap[host]];

  // 5) 域名后缀表
  for (const { suffix, target } of rules.hostSuffixMap) {
    if (host === suffix || host.endsWith('.' + suffix)) return [...target];
  }

  // 6) 关键词兜底
  const blob = ((bm.title || '') + ' ' + (bm.path || []).join(' ') + ' ' + url).toLowerCase();
  for (const { words, target } of rules.keywords) {
    if (words.some((w) => blob.includes(w.toLowerCase()))) return [...target];
  }

  return UNCLASSIFIED;
}

/** 规则体检：找出配置里的问题 */
export function validateRules(rules) {
  const problems = [];
  const tops = new Set(rules.topFolders || []);
  const checkTarget = (t, where) => {
    if (!Array.isArray(t) || !t.length) problems.push(`${where}: target 必须是非空数组`);
    else if (!tops.has(t[0])) problems.push(`${where}: 一级目录「${t[0]}」不在 topFolders 中`);
  };
  Object.entries(rules.domainMap || {}).forEach(([k, v]) => checkTarget(v, `domainMap["${k}"]`));
  (rules.hostSuffixMap || []).forEach((r, i) => checkTarget(r.target, `hostSuffixMap[${i}]`));
  (rules.keywords || []).forEach((r, i) => checkTarget(r.target, `keywords[${i}]`));
  return problems;
}

/** 全库分类预览：返回 [{bookmark, target, needsMove}] */
export async function buildPlan(bookmarks, rules, getFolderIdByPath) {
  const plan = [];
  for (const bm of bookmarks) {
    const target = classify(bm, rules);
    const currentPath = bm.path.slice(1); // 去掉根节点名
    const needsMove = target.join('/') !== currentPath.join('/');
    plan.push({
      bookmark: bm,
      target,
      currentPath,
      needsMove,
    });
  }
  return plan;
}
