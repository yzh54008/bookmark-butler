# -*- coding: utf-8 -*-
"""深挖：完整目录树 + 重复来源定位 + 去重后的真实内容清单"""
import json, os, collections, re
from urllib.parse import urlparse

OUT = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
with open(os.path.join(OUT, "Bookmarks.original.json"), encoding="utf-8") as f:
    data = json.load(f)
roots = data["roots"]

L = []
w = L.append
bookmarks, folders = [], []

def walk(node, path, depth):
    for c in node.get("children", []) or []:
        n = (c.get("name") or "").strip()
        if c.get("type") == "folder":
            folders.append({"path": path + [n], "children": len(c.get("children", []) or [])})
            walk(c, path + [n], depth + 1)
        elif c.get("type") == "url":
            bookmarks.append({"name": n, "url": c.get("url") or "", "path": path,
                              "depth": depth, "date_added": c.get("date_added")})

for key in ("bookmark_bar", "other", "synced"):
    r = roots.get(key)
    if not r: continue
    top = r.get("name") or key
    folders.append({"path": [top], "children": len(r.get("children", []) or [])})
    walk(r, [top], 1)

# ---------- 完整目录树 ----------
w("=" * 78)
w("完整目录树（F=文件夹  B=书签）")
w("=" * 78)
def dump(node, path, indent):
    for c in node.get("children", []) or []:
        n = (c.get("name") or "").strip()
        if c.get("type") == "folder":
            cnt = len(c.get("children", []) or [])
            w(f"{'  '*indent}[F] {n}  ({cnt})")
            dump(c, path + [n], indent + 1)
        else:
            u = c.get("url") or ""
            d = urlparse(u).netloc.lower().replace("www.", "")
            w(f"{'  '*indent} · {n[:52]:<52} {d[:34]}")
for key in ("bookmark_bar", "other", "synced"):
    r = roots.get(key)
    if not r: continue
    w(f"\n===== {r.get('name') or key} ({len(r.get('children',[]))} 项) =====")
    dump(r, [r.get("name") or key], 1)

# ---------- 重复来源定位 ----------
w("\n" + "=" * 78)
w("重复来源定位（同一 URL 分别落在哪些目录）")
w("=" * 78)
def norm(u):
    u = re.sub(r"^https?://", "", u.strip().rstrip("/"))
    return re.sub(r"^www\.", "", u).lower()
by_url = collections.defaultdict(list)
for b in bookmarks:
    if b["url"]: by_url[norm(b["url"])].append(b)

# 按"路径指纹"统计——哪些目录贡献了最多重复
def pathkey(b):
    return " / ".join(b["path"])
pk = collections.Counter()
dupmap = collections.Counter()
for k, v in by_url.items():
    if len(v) > 1:
        for b in v:
            pk[pathkey(b)] += 1
            dupmap[" / ".join(b["path"])] += 1

w("\n-- 按目录看『该目录里有多少条是重复的』 --")
for p, c in pk.most_common(30):
    total = sum(1 for b in bookmarks if pathkey(b) == p)
    w(f"    重复 {c:4d} / 共 {total:4d} 条   {p}")

w("\n-- 按 URL 看『同一网址散落在几个目录』TOP 15 --")
for k, v in sorted(by_url.items(), key=lambda x: -len(x[1]))[:15]:
    w(f"\n  x{len(v)}  {v[0]['name'][:44]}")
    w(f"        {k[:70]}")
    for b in v:
        w(f"        └ {pathkey(b)}")

# ---------- 去重后的“真实”清单 ----------
uniq = {}
for k, v in by_url.items():
    v2 = sorted(v, key=lambda x: x.get("date_added") or "")
    uniq[k] = v2[0]   # 保留最早添加的那份
dup_total = sum(len(v) - 1 for v in by_url.values() if len(v) > 1)
w("\n" + "=" * 78)
w(f"去重结果：{len(bookmarks)} 条 -> {len(uniq)} 条唯一网址（可删除 {dup_total} 条纯重复）")
w("=" * 78)

# 唯一清单按域名归类
dom = collections.defaultdict(list)
for k, b in uniq.items():
    d = urlparse(b["url"]).netloc.lower().replace("www.", "")
    dom[d].append(b)
w(f"\n去重后涉及 {len(dom)} 个域名。TOP 50 域名及其唯一书签数：")
for d, v in sorted(dom.items(), key=lambda x: -len(x[1]))[:50]:
    w(f"  {len(v):4d}  {d}")

with open(os.path.join(OUT, "tree_full.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(L))
with open(os.path.join(OUT, "unique.json"), "w", encoding="utf-8") as f:
    json.dump({k: {"name": v["name"], "url": v["url"], "path": v["path"],
                   "date_added": v["date_added"]} for k, v in uniq.items()},
              f, ensure_ascii=False, indent=1)
print("OK unique:", len(uniq), "dup_total:", dup_total)
