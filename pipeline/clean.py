# -*- coding: utf-8 -*-
"""
Edge 收藏夹一次性整理：
  1) 删除 4 个「从…导入」残留文件夹（重复的真正来源）
  2) 按 URL 去重，同一网址只保留一份（保留最早添加时间、合并访问次数）
  3) 修复 56 条空白标题（零宽字符导致）
  4) 按 12 个业务域重建目录，深度封顶 2 层
  5) 按 Chromium 官方算法重算 checksum
输出 Bookmarks.cleaned.json，不触碰原文件。
"""
import json, os, re, uuid, hashlib, collections, unicodedata
from urllib.parse import urlparse

W = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
SRC = os.path.join(W, "Bookmarks.original.json")

with open(SRC, encoding="utf-8") as f:
    data = json.load(f)
roots = data["roots"]

ROOT_KEYS = ("bookmark_bar", "other", "synced")
ROOT_NAMES = {"bookmark_bar": "收藏夹栏", "other": "其他收藏夹", "synced": "移动收藏夹"}

# ---------------- 1. 收集所有书签 ----------------
bookmarks = []

def walk(node, path):
    for c in node.get("children", []) or []:
        if c.get("type") == "folder":
            walk(c, path + [(c.get("name") or "").strip()])
        elif c.get("type") == "url":
            bookmarks.append({
                "raw_name": c.get("name") or "",
                "url": c.get("url") or "",
                "path": path,
                "date_added": c.get("date_added") or "0",
                "date_last_used": c.get("date_last_used") or "0",
                "visit_count": c.get("visit_count") or 0,
                "guid": c.get("guid"),
                "source": c.get("source"),
                "show_icon": c.get("show_icon", False),
            })

for k in ROOT_KEYS:
    if roots.get(k):
        walk(roots[k], [ROOT_NAMES[k]])

TOTAL_RAW = len(bookmarks)

# ---------------- 2. 清洗标题 ----------------
ZW = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]")

def clean_title(name):
    """剥掉零宽/格式控制字符（unicodedata 类别 Cf），修掉 '…扣子案例' 这类拼接残留"""
    s = "".join(ch for ch in name if unicodedata.category(ch) != "Cf")
    s = ZW.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def nice_title(bm):
    t = clean_title(bm["raw_name"])
    if len(t) >= 4:
        return t
    # 标题空白/过短：用域名 + 路径末段兜底生成可读名
    try:
        p = urlparse(bm["url"])
        host = p.netloc.split(":")[0].replace("www.", "")
        seg = [x for x in p.path.split("/") if x]
        tail = seg[-1][:24] if seg else ""
        t2 = f"{host} / {tail}" if tail else host
        return (t + " · " + t2) if t else t2
    except Exception:
        return bm["url"][:40] or "(无标题)"

# ---------------- 3. 去重 ----------------
def norm(u):
    u = u.strip().rstrip("/")
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    u = re.sub(r"[?&](utm_[^&]*|fromscen[^&]*|data_source=[^&]*)$", "", u)
    return u.lower()

groups = collections.OrderedDict()
for b in bookmarks:
    if not b["url"]:
        continue
    groups.setdefault(norm(b["url"]), []).append(b)

unique = []
merged_dupes = 0
for key, g in groups.items():
    if len(g) > 1:
        merged_dupes += len(g) - 1
    g2 = sorted(g, key=lambda x: (int(x["date_added"] or 0)))
    keeper = dict(g2[0])
    keeper["visit_count"] = sum(int(x["visit_count"] or 0) for x in g)
    keeper["date_last_used"] = max((x["date_last_used"] for x in g), default="0")
    best = None
    for x in g:
        t = clean_title(x["raw_name"])
        if len(t) >= 4 and (best is None or len(t) > len(best)):
            best = t
    keeper["name"] = best or nice_title(keeper)
    keeper["dupe_count"] = len(g)
    unique.append(keeper)

# ---------------- 4. 业务域分类 ----------------
TOP = {
    "ozon":  "01 · OZON 运营",
    "erp":   "02 · ERP 与选品",
    "src":   "03 · 货源与采购",
    "logi":  "04 · 物流与海外仓",
    "pay":   "05 · 支付与财税",
    "site":  "06 · 独立站与域名",
    "ai":    "07 · AI 工具与自动化",
    "cloud": "08 · 云服务与开发",
    "learn": "09 · 学习资料",
    "biz":   "10 · 商务与政务",
    "tool":  "11 · 素材工具箱",
    "soc":   "12 · 社媒与内容",
    "self":  "13 · 自有服务与内网",
}
TOP_ORDER = ["ozon", "erp", "src", "logi", "pay", "site", "ai",
             "cloud", "learn", "biz", "tool", "soc", "self"]

# 域名 -> (一级key, 二级名或None)
D = {
    # --- OZON ---
    "seller.ozon.ru": ("ozon", "卖家后台"),
    "docs.ozon.ru": ("ozon", "规则与学习"),
    "ozon.wiki": ("ozon", "规则与学习"),
    # --- ERP / 选品 ---
    "erp.91miaoshou.com": ("erp", "ERP 系统"),
    "ozon.maozierp.com": ("erp", "ERP 系统"),
    "bdmozon.com": ("erp", "ERP 系统"),
    "ozon.xingfandu.com": ("erp", "ERP 系统"),
    "vicserp.com": ("erp", "ERP 系统"),
    "dianxiaomi.com": ("erp", "ERP 系统"),
    "damao.shanshangnet.com": ("erp", "ERP 系统"),
    "luotuoerp.cn": ("erp", "ERP 系统"),
    "my.jizhangerp.com": ("erp", "ERP 系统"),
    "myozoncs.com": ("erp", "ERP 系统"),
    "genmaijl.com": ("erp", "ERP 系统"),
    "shopbang.cn": ("erp", "ERP 系统"),
    "shunshun-erp.oem.niubeiapp.com": ("erp", "ERP 系统"),
    "scc.litb.cn": ("erp", "ERP 系统"),
    "ozon.menglar.com": ("erp", "选品与数据"),
    "seerfar.cn": ("erp", "选品与数据"),
    "ozon.kwoniu.com": ("erp", "选品与数据"),
    "geekozon.cn": ("erp", "选品与数据"),
    "kuajing84.com": ("erp", "选品与数据"),
    "linkfox.com": ("erp", "选品与数据"),
    "sdsdiy.com": ("erp", "选品与数据"),
    "zh.accio.com": ("erp", "选品与数据"),
    "wordstat.yandex.com": ("erp", "选品与数据"),
    # --- 物流 ---
    "ru-wulaer-console.ztocwst.com": ("logi", None),
    "tmsplus.ilinexpress.com": ("logi", None),
    "tms.celdt.cn": ("logi", None),
    "jcex.com": ("logi", None),
    "dhl.com": ("logi", None),
    "ups.com": ("logi", None),
    "gdeposylka.ru": ("logi", None),
    "szdpxx.cn": ("logi", None),
    "seller.unitrade.space": ("logi", None),
    # --- 支付财税 ---
    "airwallex.com": ("pay", None),
    "portal.worldfirst.com.cn": ("pay", None),
    "cn.lianlianpay.com": ("pay", None),
    "paypal.cn": ("pay", None),
    "netc1.igtb.bankofchina.com": ("pay", None),
    "etax.jiangsu.chinatax.gov.cn": ("pay", None),
    "tpass.jiangsu.chinatax.gov.cn": ("pay", None),
    "shanghai.chinatax.gov.cn": ("pay", None),
    "etax.shanghai.chinatax.gov.cn": ("pay", None),
    # --- 独立站 ---
    "admin.shopify.com": ("site", None),
    "wanwang.aliyun.com": ("site", None),
    "dc.console.aliyun.com": ("site", None),
    "sharpseam.com": ("site", None),
    "indochino.com": ("site", None),
    # --- AI ---
    "chat.deepseek.com": ("ai", "对话与模型"),
    "platform.deepseek.com": ("ai", "对话与模型"),
    "chatglm.cn": ("ai", "对话与模型"),
    "kimi.moonshot.cn": ("ai", "对话与模型"),
    "metaso.cn": ("ai", "对话与模型"),
    "so.360.com": ("ai", "对话与模型"),
    "chatgpt.com": ("ai", "对话与模型"),
    "openrouter.ai": ("ai", "对话与模型"),
    "ofox.ai": ("ai", "对话与模型"),
    "shiyunapi.com": ("ai", "对话与模型"),
    "platform.xiaomimimo.com": ("ai", "对话与模型"),
    "bailian.console.aliyun.com": ("ai", "对话与模型"),
    "aistudio.yandex.ru": ("ai", "对话与模型"),
    "jimeng.jianying.com": ("ai", "图像与设计"),
    "liblib.art": ("ai", "图像与设计"),
    "pictech.cc": ("ai", "图像与设计"),
    "nanobanana.co": ("ai", "图像与设计"),
    "tongyi.aliyun.com": ("ai", "图像与设计"),
    "canva.cn": ("ai", "图像与设计"),
    "yiketu.com": ("ai", "图像与设计"),
    "remove.bg": ("ai", "图像与设计"),
    "coze.cn": ("ai", "自动化平台"),
    "dify.ai": ("ai", "自动化平台"),
    "make.com": ("ai", "自动化平台"),
    "yingdao.com": ("ai", "自动化平台"),
    "cocoloop.cn": ("ai", "自动化平台"),
    "hub.cocoloop.cn": ("ai", "自动化平台"),
    # --- 云与开发 ---
    "github.com": ("cloud", None),
    "dash.cloudflare.com": ("cloud", None),
    "qiniu.com": ("cloud", None),
    "cloud.tencent.com": ("cloud", None),
    "my.heiying.org": ("cloud", None),
    "mojie.uk": ("cloud", None),
    "mojie.co": ("cloud", None),
    # --- 学习资料 ---
    "bzfree.com": ("learn", None),
    "docs.qq.com": ("learn", None),
    "kdocs.cn": ("learn", None),
    # --- 商务政务 ---
    "zhipin.com": ("biz", None),
    "zhaopin.com": ("biz", None),
    "freelancer.com": ("biz", None),
    "upwork.com": ("biz", None),
    "wcjs.sbj.cnipa.gov.cn": ("biz", None),
    "sso.cnipa.gov.cn": ("biz", None),
    "beian.mps.gov.cn": ("biz", None),
    "tsm.miit.gov.cn": ("biz", None),
    "scjg.jszwfw.gov.cn": ("biz", None),
    "jszwfw.gov.cn": ("biz", None),
    "jszwfw.gjzwfw.gov.cn": ("biz", None),
    "zwdt.sh.gov.cn": ("biz", None),
    "yct.sh.gov.cn": ("biz", None),
    "singlewindow.cn": ("biz", None),
    "swapp.singlewindow.cn": ("biz", None),
    "mail.google.com": ("biz", None),
    "outlook.live.com": ("biz", None),
    # --- 素材工具 ---
    "feiyudo.com": ("tool", None),
    "datatool.vip": ("tool", None),
    "aconvert.com": ("tool", None),
    "panmeme.com": ("tool", None),
    "postimages.org": ("tool", None),
    "excalidraw.com": ("tool", None),
    "js.design": ("tool", None),
    "w3ctool.com": ("tool", None),
    "translate.yandex.com": ("tool", None),
    # --- 社媒 ---
    "bilibili.com": ("soc", None),
    "douyin.com": ("soc", None),
    "creator.douyin.com": ("soc", None),
    "life.douyin.com": ("soc", None),
    # --- 自有服务 ---
    "a.beizijinfu.com": ("self", None),
    # --- 货源与采购 · 电商货源 ---
    "1688.com": ("src", "电商货源"),
    "168dmj.com": ("src", "电商货源"),
    "sooxie.com": ("src", "电商货源"),
    "www.17mjf.com": ("src", "电商货源"),
    "www.bao66.cn": ("src", "电商货源"),
    "www.hznzcn.com": ("src", "电商货源"),
    "www.k3.cn": ("src", "电商货源"),
    "www.mmgg.com": ("src", "电商货源"),
    "www.rongqu.net": ("src", "电商货源"),
    "www.wlys.cn": ("src", "电商货源"),
    "www.xingfujie.cn": ("src", "电商货源"),
    "www.yunchepin.cn": ("src", "电商货源"),
    "www.zhaojiafang.com": ("src", "电商货源"),
    "www.babyzhiai.net": ("src", "电商货源"),
    "shop.boqii.com": ("src", "电商货源"),
    "b2b.fulu.com": ("src", "电商货源"),
    "www.dianleida.net": ("src", "电商货源"),
    "www.yunqishuju.com": ("src", "电商货源"),
    "www.ozonbigsell.com": ("src", "电商货源"),
    "www.bcsozon.com": ("src", "电商货源"),
    "www.partnershare.cn": ("src", "电商货源"),
    "32cd.com": ("src", "电商货源"),
    "mobile.yangkeduo.com": ("src", "电商货源"),
    "www.51selling.com": ("src", "电商货源"),
    # --- 货源与采购 · 电子元器件 ---
    "www.dzsc.com": ("src", "电子元器件"),
    "www.hqchip.com": ("src", "电子元器件"),
    "www.hqew.com": ("src", "电子元器件"),
    "www.ichunt.com": ("src", "电子元器件"),
    "www.ickey.cn": ("src", "电子元器件"),
    "www.szlcsc.com": ("src", "电子元器件"),
    # --- 物流补充 ---
    "ru-wulaer-console.ztocwstcrossborder.com": ("logi", None),
    "sellerdev.unitrade.space": ("logi", None),
    "unitrade-global.com": ("logi", None),
    # --- 支付补充 ---
    "global.lianlianpay.com": ("pay", None),
    # --- 独立站补充 ---
    "www.azazie.com": ("site", None),
    # --- AI · 图像与设计补充 ---
    "ai-bot.cn": ("ai", "图像与设计"),
    "ai.yanqueai.com": ("ai", "图像与设计"),
    "app.klingai.com": ("ai", "图像与设计"),
    "jiandan.link": ("ai", "图像与设计"),
    "kt.94xy.com": ("ai", "图像与设计"),
    "m.gaoding.com": ("ai", "图像与设计"),
    "ps.gaoding.com": ("ai", "图像与设计"),
    "magiceraser.pro": ("ai", "图像与设计"),
    "remove.photos": ("ai", "图像与设计"),
    "tinywow.com": ("ai", "图像与设计"),
    "www.recraft.ai": ("ai", "图像与设计"),
    "www.roboneo.com": ("ai", "图像与设计"),
    "zh.bgsub.com": ("ai", "图像与设计"),
    "anywebp.com": ("ai", "图像与设计"),
    "products.aspose.app": ("ai", "图像与设计"),
    "cn.jollytoday.com": ("ai", "图像与设计"),
    "www.wangdaozi.com": ("ai", "图像与设计"),
    "www.doubao.com": ("ai", "对话与模型"),
    # --- 云与开发补充 ---
    "help.viewturbo.com": ("cloud", None),
    # --- 学习补充 ---
    "phet.colorado.edu": ("learn", None),
    # --- 商务政务补充 ---
    "jscopyright.cn": ("biz", None),
    "shbqdj.cn": ("biz", None),
    "mail.qq.com": ("biz", None),
    # --- 素材工具补充 ---
    "www.58pic.com": ("tool", None),
    "www.emojiall.com": ("tool", None),
    "www.ruancang.net": ("tool", None),
    "pan.baidu.com": ("tool", None),
    "map.baidu.com": ("tool", None),
    "www.baidu.com": ("tool", None),
    "www.bing.com": ("tool", None),
    "newtab": ("tool", None),
    "grizzlysms.com": ("tool", None),
    "bd.ykdfr.com": ("tool", None),
    "translate.yandex.ru": ("tool", None),
    # --- 社媒补充 ---
    "www.xiaohongshu.com": ("soc", None),
    "www.zhihu.com": ("soc", None),
    "fxg.jinritemai.com": ("soc", None),
}

def classify(b):
    p = urlparse(b["url"])
    host = p.netloc.lower()
    host_np = host.replace("www.", "")
    bare = host.split(":")[0]
    t = b["name"]
    orig = " ".join(b["path"])

    # 内网 / 自有服务
    if bare in ("localhost", "127.0.0.1") or host.startswith("10.") or \
       re.match(r"^(192\.168|172\.(1[6-9]|2\d|3[01])\.|100\.)", bare) or \
       "stagcraft.com" in bare or bare in ("43.131.249.111", "1.12.55.94", "121.196.217.107"):
        return ("self", None)

    # OZON 主站：区分 店铺 / 类目页 / 其他
    if bare in ("ozon.ru", "www.ozon.ru"):
        if ("официальн" in t or "官方网店" in t or "商品目录" in t
                or "каталог" in t or "好店铺" in orig):
            return ("ozon", "官方店铺库")
        if "seller" in host:
            return ("ozon", "卖家后台")
        return ("ozon", "前台类目页")

    # 其他平台
    if host_np in ("wildberries.ru", "yandex.com", "wap.yandex.com",
                   "market.yandex.ru", "partner.market.yandex.ru",
                   "seller.shopee.cn"):
        return ("ozon", "其他平台")

    # 飞书 / lark 文档族
    if bare.endswith("feishu.cn") or bare.endswith("larksuite.com") or bare.endswith("larkoffice.com"):
        return ("learn", None)

    if host_np in D:
        return D[host_np]
    if bare in D:
        return D[bare]

    # 关键词兜底（仅对域名规则未命中的少数站点生效，结果会进报告复核）
    blob = (t + " " + orig).lower()
    KW = [
        (("货源", "批发", "一件代发", "网批", "网供", "供货", "分销", "代发"), ("src", "电商货源")),
        (("电子元器件", "元器件", "bom配单", "smt贴片", "pcb打样"), ("src", "电子元器件")),
        (("抠图", "背景移除", "去除背景", "图片处理", "图库", "素材网", "设计素材"), ("ai", "图像与设计")),
        (("物流", "快递", "轨迹查询", "海外仓", "报关", "国际货运"), ("logi", None)),
        (("著作权", "知识产权", "政务服务", "电子税务"), ("biz", None)),
    ]
    for words, target in KW:
        if any(x in blob for x in words):
            return target
    return (None, None)

for b in unique:
    top, sub = classify(b)
    b["top"], b["sub"] = top, sub

unmatched = [b for b in unique if b["top"] is None]

# ---------------- 5. 构建新目录树 ----------------
def new_guid():
    return str(uuid.uuid4())

def new_id(counter):
    counter[0] += 1
    return str(counter[0])

NOW = "13433000000000000"
counter = [3]


def mk_leaf(b, counter):
    return {
        "date_added": b["date_added"],
        "date_last_used": b["date_last_used"],
        "guid": b["guid"] or new_guid(),
        "id": new_id(counter),
        "name": b["name"][:180],
        "show_icon": False,
        "source": b["source"] or "sync",
        "type": "url",
        "url": b["url"],
        "visit_count": int(b["visit_count"] or 0),
    }


tree = collections.defaultdict(lambda: collections.defaultdict(list))
for b in unique:
    if b["top"] is None:
        continue
    tree[b["top"]][b["sub"]].append(b)

bar_children = []
for key in TOP_ORDER:
    if key not in tree:
        continue
    subs = tree[key]
    folder_id = new_id(counter)
    folder = {
        "children": [],
        "date_added": NOW,
        "date_last_used": "0",
        "date_modified": NOW,
        "guid": new_guid(),
        "id": folder_id,
        "name": TOP[key],
        "type": "folder",
    }
    named = {k: v for k, v in subs.items() if k}
    flat = subs.get(None, [])

    if named:
        for sub_name in sorted(named):
            items = sorted(named[sub_name], key=lambda x: x["name"].lower())
            sub_id = new_id(counter)
            sub_folder = {
                "children": [], "date_added": NOW, "date_last_used": "0",
                "date_modified": NOW, "guid": new_guid(), "id": sub_id,
                "name": sub_name, "type": "folder",
            }
            for b in items:
                sub_folder["children"].append(mk_leaf(b, counter))
            folder["children"].append(sub_folder)
    for b in sorted(flat, key=lambda x: x["name"].lower()):
        folder["children"].append(mk_leaf(b, counter))
    bar_children.append(folder)

# 未分类的放到「其他收藏夹」，不丢数据
pending = []
for b in unmatched:
    pending.append(mk_leaf(b, counter))

new_roots = {
    "bookmark_bar": {
        "children": bar_children, "date_added": NOW, "date_last_used": "0",
        "date_modified": NOW, "guid": roots["bookmark_bar"].get("guid") or new_guid(),
        "id": "1", "name": "收藏夹栏", "type": "folder",
    },
    "other": {
        "children": pending, "date_added": NOW, "date_last_used": "0",
        "date_modified": NOW, "guid": roots["other"].get("guid") or new_guid(),
        "id": "2", "name": "待整理（原「其他收藏夹」）", "type": "folder",
    },
    "synced": {
        "children": [], "date_added": NOW, "date_last_used": "0",
        "date_modified": NOW, "guid": roots["synced"].get("guid") or new_guid(),
        "id": "3", "name": "移动收藏夹", "type": "folder",
    },
}

# ---------------- 6. 计算 checksum（Chromium 官方算法） ----------------
def update(md5, val):
    if isinstance(val, str):
        md5.update(val.encode("utf-8"))
    else:
        md5.update(val)

def checksum_node(node, md5):
    if node.get("type") == "url":
        update(md5, node["id"])
        update(md5, node["name"].encode("utf-16-le"))
        update(md5, "url")
        update(md5, node["url"])
    else:
        update(md5, node["id"])
        update(md5, node["name"].encode("utf-16-le"))
        update(md5, "folder")
        for c in node.get("children", []) or []:
            checksum_node(c, md5)

md5 = hashlib.md5()
for k in ROOT_KEYS:
    checksum_node(new_roots[k], md5)
ck = md5.hexdigest()

out = {
    "checksum": ck,
    "roots": new_roots,
    "version": data.get("version", 1),
}

dst = os.path.join(W, "Bookmarks.cleaned.json")
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=3)

# ---------------- 7. 报告 ----------------
R = []
a = R.append
a("=" * 74)
a("整理结果")
a("=" * 74)
a(f"原始书签            : {TOTAL_RAW}")
a(f"合并掉的重复        : {merged_dupes}")
a(f"去重后唯一          : {len(unique)}")
a(f"成功归入业务域      : {len(unique) - len(unmatched)}")
a(f"未能归类(进「待整理」): {len(unmatched)}")
a(f"新建 Top 文件夹      : {len(bar_children)}")
a(f"checksum (MD5)      : {ck}")
a("")
a("【新目录结构】")
for f in bar_children:
    subs = [c for c in f["children"] if c["type"] == "folder"]
    leaves = [c for c in f["children"] if c["type"] == "url"]
    n = sum(len(s["children"]) for s in subs) + len(leaves)
    a(f"  {f['name']}   ({n} 条)")
    for s in subs:
        a(f"      └ {s['name']}  ({len(s['children'])})")
    if leaves:
        a(f"      └ (直接放置 {len(leaves)} 条)")
a("")
a("【未归类明细（需人工决定归属）】")
for b in sorted(unmatched, key=lambda x: urlparse(x["url"]).netloc):
    a(f"  {b['name'][:46]:<46} | {urlparse(b['url']).netloc}")
a("")
a("【空白标题修复示例】")
fixed = [b for b in unique if not clean_title(b["raw_name"])]
for b in fixed[:20]:
    a(f"  (空) -> {b['name'][:60]}")

with open(os.path.join(W, "cleanup_report.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(R))
print("OK raw=%d unique=%d unmatched=%d" % (TOTAL_RAW, len(unique), len(unmatched)))
