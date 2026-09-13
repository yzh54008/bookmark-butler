# -*- coding: utf-8 -*-
"""只读分析 Edge 收藏夹：结构、深度、重复、域名分布、命名问题。"""
import json, os, shutil, collections, re
from urllib.parse import urlparse

SRC = r"C:\Users\yangzhiheng\AppData\Local\Microsoft\Edge\User Data\Default\Bookmarks"
OUT = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
os.makedirs(OUT, exist_ok=True)

copy_path = os.path.join(OUT, "Bookmarks.original.json")
shutil.copy2(SRC, copy_path)

with open(copy_path, encoding="utf-8") as f:
    data = json.load(f)

roots = data.get("roots", {})
report = []
w = report.append

# ---------- 遍历 ----------
nodes = []          # 所有节点
folders = []        # 文件夹
bookmarks = []      # 书签

def walk(node, path, depth, parent_kind):
    for child in node.get("children", []) or []:
        ctype = child.get("type")
        name = (child.get("name") or "").strip()
        if ctype == "folder":
            folders.append({
                "name": name, "path": path + [name], "depth": depth,
                "children": len(child.get("children", []) or []),
                "date_added": child.get("date_added"),
                "guid": child.get("guid"), "id": child.get("id"),
            })
            walk(child, path + [name], depth + 1, "folder")
        elif ctype == "url":
            url = child.get("url") or ""
            bookmarks.append({
                "name": name, "url": url, "path": path, "depth": depth,
                "date_added": child.get("date_added"), "guid": child.get("guid"),
                "id": child.get("id"), "parent_kind": parent_kind,
            })

for key in ("bookmark_bar", "other", "synced"):
    if key in roots and roots[key]:
        top_name = roots[key].get("name") or key
        folders.append({"name": top_name, "path": [top_name], "depth": 0,
                        "children": len(roots[key].get("children", []) or []),
                        "date_added": roots[key].get("date_added"),
                        "guid": roots[key].get("guid"), "id": roots[key].get("id")})
        walk(roots[key], [top_name], 1, key)

w("=" * 70)
w("Edge 收藏夹 结构性诊断报告")
w("=" * 70)
w(f"文件大小            : {os.path.getsize(copy_path):,} bytes")
w(f"书签总数            : {len(bookmarks):,}")
w(f"文件夹总数          : {len(folders):,}")
w(f"节点总数            : {len(bookmarks) + len(folders):,}")
w(f"收藏夹根            : {', '.join(k for k in ('bookmark_bar','other','synced') if roots.get(k))}")
w("")

# ---------- 深度分布 ----------
depths = collections.Counter(b["depth"] for b in bookmarks)
w("【1. 嵌套深度分布】")
for d in sorted(depths):
    bar = "#" * min(60, int(depths[d] / max(1, max(depths.values())) * 60))
    w(f"  第{d}层: {depths[d]:5d} 条  {bar}")
w(f"  最大深度: {max(depths) if depths else 0} 层")
w("")

# ---------- 顶层结构 ----------
w("【2. 顶层/二级 目录规模】")
top = sorted([f for f in folders if f["depth"] <= 1], key=lambda x: -x["children"])
for f in top[:40]:
    indent = "  " * f["depth"]
    w(f"  {indent}{f['name'] or '(未命名)'}  -> {f['children']} 项")
w("")

# ---------- 未分类散落书签 ----------
bar = roots.get("bookmark_bar") or {}
other = roots.get("other") or {}
loose = [b for b in bookmarks if b["depth"] <= 1]
loose_bar = [b for b in bookmarks if b["depth"] == 1 and b["path"] and b["path"][0] == (bar.get("name") or "收藏夹栏")]
w("【3. 散落(未归入子文件夹)的书签】")
w(f"  收藏夹栏直接平铺        : {len(loose_bar)} 条")
w(f"  其它收藏 根目录直接平铺  : {len([b for b in bookmarks if b['depth']==1 and b['path'] and b['path'][0]==(other.get('name') or '其它收藏')])} 条")
w("")

# ---------- 空文件夹 / 单元素文件夹 ----------
empty = [f for f in folders if f["children"] == 0 and f["depth"] > 0]
single = [f for f in folders if f["children"] == 1 and f["depth"] > 0]
big = [f for f in folders if f["children"] > 50]
w("【4. 文件夹健康度】")
w(f"  空文件夹          : {len(empty)} 个")
for f in empty[:15]:
    w(f"      - {' / '.join(f['path'])}")
w(f"  仅 1 个条目       : {len(single)} 个")
for f in single[:10]:
    w(f"      - {' / '.join(f['path'])}")
w(f"  超过 50 条的大杂烩 : {len(big)} 个")
for f in sorted(big, key=lambda x: -x["children"])[:15]:
    w(f"      - {' / '.join(f['path'])}  ({f['children']} 项)")
w("")

# ---------- 重复 ----------
def norm(u):
    u = u.strip().rstrip("/")
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    return u.lower()

by_url = collections.defaultdict(list)
by_title = collections.defaultdict(list)
for b in bookmarks:
    if b["url"]:
        by_url[norm(b["url"])].append(b)
    if b["name"]:
        by_title[b["name"].strip().lower()].append(b)

dup_url = {k: v for k, v in by_url.items() if len(v) > 1}
dup_title = {k: v for k, v in by_title.items() if len(v) > 1}
w("【5. 重复情况】")
w(f"  完全重复的 URL     : {len(dup_url)} 组，涉及 {sum(len(v) for v in dup_url.values())} 条书签")
for k, v in sorted(dup_url.items(), key=lambda x: -len(x[1]))[:20]:
    w(f"      x{len(v)}  {v[0]['name'][:40]}  |  {k[:60]}")
w(f"  同名不同网址       : {len(dup_title)} 组（多为同一站点不同页面/失效页）")
w("")

# ---------- 域名分布 ----------
dom = collections.Counter()
for b in bookmarks:
    try:
        d = urlparse(b["url"]).netloc.lower().replace("www.", "")
    except Exception:
        d = "?"
    dom[d or "(无)"] += 1
w("【6. 域名 TOP 40】")
for d, c in dom.most_common(40):
    w(f"  {c:5d}  {d}")
w(f"  —— 共涉及 {len(dom)} 个不同域名")
w("")

# ---------- 命名问题 ----------
import unicodedata
ZWRE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]")

def strip_fmt(s):
    return ZWRE.sub("", "".join(ch for ch in (s or "")
                    if unicodedata.category(ch) != "Cf")).strip()

blank_t = [b for b in bookmarks if not strip_fmt(b["name"])]
zw_t = [b for b in bookmarks if ZWRE.search(b["name"])]
short_t = [b for b in bookmarks if 0 < len(strip_fmt(b["name"])) <= 3]
long_t = [b for b in bookmarks if len(strip_fmt(b["name"])) > 60]

w("【7. 命名质量问题】（长度均按去掉零宽/格式字符后计算）")
w(f"  真正完全空白           : {len(blank_t)} 条")
w(f"  含零宽/格式控制字符     : {len(zw_t)} 条   <-- 浏览器里会显示异常，是真正的病根")
w(f"  清洗后长度 <= 3        : {len(short_t)} 条   (多为 OZON / MY / 扣子 等正常短标题)")
w(f"  清洗后长度 > 60        : {len(long_t)} 条")
w(f"  同名重复(同一标题多份)   : {sum(1 for k, v in by_title.items() if len(v) > 1)} 组")
w("")

# ---------- 关键词聚类线索 ----------
kw = {
    "OZON/俄区电商": ["ozon", "俄罗斯", "russia", "wildberries", "yandex", "1688", "aliexpress", "速卖通", "跨境"],
    "数据分析/选品工具": ["选品", "数据", "分析", "trend", "trends", "keyword", "卖家", "生意", "参谋", "魔镜", "店查查", "keepa", "jungle", "helium"],
    "AI 工具": ["ai", "chatgpt", "gpt", "claude", "gemini", "midjourney", "kimi", "deepseek", "通义", "豆包", "文心"],
    "开发/技术": ["github", "gitlab", "stackoverflow", "npm", "vue", "electron", "nodejs", "csdn", "juejin", "博客园", "segmentfault", "文档", "docs"],
    "素材/设计": ["图库", "素材", "png", "icon", "font", "字体", "设计", "behance", "dribbble", "unsplash", "pexels", "canva"],
    "社媒/内容": ["youtube", "bilibili", "抖音", "小红书", "知乎", "微博", "tiktok", "vk.com", "telegram"],
    "物流/ERP": ["物流", "快递", "erp", "打单", "仓储", "海外仓", "4px", "燕文"],
    "支付/财税": ["支付", "pay", "结汇", "税务", "发票", "银行"],
}
guessed = collections.Counter()
w("【8. 按关键词可归类的书签数(粗判)】")
for cat, words in kw.items():
    n = 0
    for b in bookmarks:
        blob = (b["name"] + " " + b["url"]).lower()
        if any(x in blob for x in words):
            n += 1
    guessed[cat] = n
    w(f"  {cat:20s}: {n}")
unmatched = len(bookmarks) - sum(guessed.values())
w(f"  {'未匹配任何规则':20s}: {unmatched}  (注: 一条可能命中多类，此处为上限估算)")
w("")

with open(os.path.join(OUT, "report.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(report))

with open(os.path.join(OUT, "tree.json"), "w", encoding="utf-8") as f:
    json.dump({"folders": folders, "bookmarks": bookmarks}, f, ensure_ascii=False, indent=1)

print("OK", len(bookmarks), "bookmarks,", len(folders), "folders")
