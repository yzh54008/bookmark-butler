import json, hashlib, os, collections, re, unicodedata

LIVE = os.path.join(os.environ["LOCALAPPDATA"],
                    "Microsoft", "Edge", "User Data", "Default", "Bookmarks")
OUT  = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work\live_verify.txt"

R = []
def w(s=""):
    R.append(s)

data = json.load(open(LIVE, encoding="utf-8"))
w("=" * 62)
w(" 浏览器中正在生效的收藏夹 —— 实物核验")
w("=" * 62)
w(f"文件: {LIVE}")
w(f"大小: {os.path.getsize(LIVE)} bytes")
w(f"md5 : {hashlib.md5(open(LIVE,'rb').read()).hexdigest().upper()}")
w(f"version = {data.get('version')}   checksum = {data.get('checksum')}")

leaves = []
def walk(node, path, depth):
    if node.get("type") == "url":
        leaves.append({
            "title": node.get("name") or "",
            "url": node.get("url") or "",
            "path": path[:],
            "depth": depth,
            "guid": node.get("guid") or "",
            "id": node.get("id"),
        })
    else:
        for c in node.get("children") or []:
            walk(c, path + [c.get("name") or "(无名)"], depth + 1)

roots = data["roots"]
rootnames = {"bookmark_bar": "收藏夹栏", "other": "其他收藏夹", "synced": "移动设备收藏"}
for k in ["bookmark_bar", "other", "synced"]:
    n = roots[k]
    w("")
    w(f"【{rootnames[k]}】 id={n.get('id')} 子项={len(n.get('children') or [])}")
    for c in n.get("children") or []:
        walk(c, [rootnames[k], c.get("name") or "(无名)"], 2)

w("")
w("=" * 62)
w(f"书签总数 = {len(leaves)}")

# 唯一性
byurl = collections.defaultdict(list)
for b in leaves:
    byurl[b["url"]].append(b)
dups = {u: v for u, v in byurl.items() if len(v) > 1}
w(f"唯一网址 = {len(byurl)}   重复组 = {len(dups)}   冗余条数 = {sum(len(v)-1 for v in dups.values())}")

# 空白 / 零宽
blank  = [b for b in leaves if not b["title"].strip()]
zw     = [b for b in leaves if any(unicodedata.category(ch) == "Cf" for ch in b["title"])]
w(f"完全空白标题 = {len(blank)}   含零宽字符 = {len(zw)}")

# 导入残留
imp = [b for b in leaves if re.search(r"从.{0,20}导入|^Imported", b["title"]) or
       any(re.search(r"从.{0,20}导入|^Imported", p) for p in b["path"])]
w(f"导入残留路径 = {len(imp)}")

# 深度
w(f"最大嵌套深度 = {max(b['depth'] for b in leaves)}")

# 各顶层域分布
w("")
w("【各业务域书签数】")
cnt = collections.Counter(b["path"][1] for b in leaves)
for name, c in sorted(cnt.items()):
    w(f"  {c:>4}  {name}")
w("")
w("【收藏夹栏顶层散落书签（未归文件夹）】")
loose = [b for b in leaves if b["path"][0] == "收藏夹栏" and b["depth"] == 2]
w(f"  {len(loose)} 条")
for b in loose[:15]:
    w(f"    - {b['title'][:50]}  {b['url'][:60]}")

# GUID 唯一性
guids = [b["guid"] for b in leaves if b["guid"]]
w("")
w(f"GUID: 总数={len(guids)} 唯一={len(set(guids))}")

# 与清理成品的逐条比对：确保浏览器里的 = 我验证过的
CLEAN = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work\Bookmarks.cleaned.json"
cdata = json.load(open(CLEAN, encoding="utf-8"))
cleaves = []
def cwalk(n):
    if n.get("type") == "url":
        cleaves.append((n.get("id"), n.get("guid"), n.get("url"), n.get("name")))
    else:
        for c in n.get("children") or []:
            cwalk(c)
for k in ["bookmark_bar", "other", "synced"]:
    for c in cdata["roots"][k].get("children") or []:
        cwalk(c)
ll = [(b["id"], b["guid"], b["url"], b["title"]) for b in leaves]
w("")
w("【与已校验成品的一致性】")
w(f"  成品条数 = {len(cleaves)}   浏览器内 = {len(ll)}")
same = set(cleaves) == set(ll) and len(cleaves) == len(ll)
w(f"  逐条完全一致（id+guid+url+title）: {'是 ✓' if same else '否 ✗'}")
if not same:
    only_c = set(cleaves) - set(ll)
    only_l = set(ll) - set(cleaves)
    w(f"  仅在成品中 = {len(only_c)}   仅在浏览器中 = {len(only_l)}")
    for x in list(only_c)[:5]:
        w(f"    only-clean: {x}")
    for x in list(only_l)[:5]:
        w(f"    only-live : {x}")

open(OUT, "w", encoding="utf-8").write("\n".join(R))
print("\n".join(R))
