# -*- coding: utf-8 -*-
"""校验 Bookmarks.cleaned.json：结构合法性 / ID 唯一性 / 零数据丢失 / checksum 自洽"""
import json, os, re, hashlib, unicodedata, collections
from urllib.parse import urlparse

W = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
orig = json.load(open(os.path.join(W, "Bookmarks.original.json"), encoding="utf-8"))
new = json.load(open(os.path.join(W, "Bookmarks.cleaned.json"), encoding="utf-8"))

R = []
ok_all = [True]
def chk(cond, msg):
    R.append(("  [OK]  " if cond else "  [FAIL]") + " " + msg)
    if not cond:
        ok_all[0] = False

R.append("=" * 68)
R.append("生成文件校验")
R.append("=" * 68)

# --- 1. 顶层结构 ---
chk(isinstance(new, dict), "根对象为 dict")
chk(new.get("version") == 1, f"version == 1 (实际 {new.get('version')})")
chk(set(new.get("roots", {}).keys()) == {"bookmark_bar", "other", "synced"},
    "roots 含 bookmark_bar / other / synced 三个永久节点")
for k in ("bookmark_bar", "other", "synced"):
    n = new["roots"][k]
    chk(n.get("type") == "folder" and n.get("id") in ("1", "2", "3"),
        f"{k}: type=folder, id={n.get('id')}")
    for f in ("guid", "name", "date_added"):
        chk(f in n, f"{k}: 含字段 {f}")

# --- 2. 遍历 + ID 唯一性 + 字段完整性 ---
ids, guids, urls, leaves, maxdepth = [], [], [], [], [0]

def walk(node, depth):
    maxdepth[0] = max(maxdepth[0], depth)
    for c in node.get("children", []) or []:
        ids.append(c.get("id"))
        guids.append(c.get("guid"))
        for f in ("id", "guid", "name", "type", "date_added"):
            if f not in c:
                chk(False, f"节点缺字段 {f}: {c.get('name')}")
        if c.get("type") == "url":
            leaves.append(c)
            if "url" not in c:
                chk(False, f"URL 节点缺 url: {c.get('name')}")
            else:
                urls.append(c["url"])
        else:
            walk(c, depth + 1)

for k in ("bookmark_bar", "other", "synced"):
    walk(new["roots"][k], 1)

dupid = [k for k, v in collections.Counter(ids).items() if v > 1]
chk(not dupid, f"ID 全局唯一 (重复: {dupid[:5]})")
dupg = [k for k, v in collections.Counter(guids).items() if v > 1]
chk(not dupg, f"GUID 全局唯一 (重复: {dupg[:5]})")
chk(all(g and re.fullmatch(r"[0-9a-f-]{36}", g or "") for g in guids), "GUID 均为合法 UUID 格式")
chk(maxdepth[0] <= 3, f"最大嵌套深度 {maxdepth[0]} 层 (<=3)")

# 父子 id 关系：所有 child id 必须 > 0 且为数字串
chk(all(str(i).isdigit() for i in ids), "所有 ID 为数字字符串")

# --- 3. checksum 自洽 ---
def cksum(o):
    md5 = hashlib.md5()
    def upd(v):
        md5.update(v if isinstance(v, bytes) else v.encode("utf-8"))
    def node(n):
        if n.get("type") == "url":
            upd(n["id"]); upd(n["name"].encode("utf-16-le")); upd("url"); upd(n["url"])
        else:
            upd(n["id"]); upd(n["name"].encode("utf-16-le")); upd("folder")
            for c in n.get("children", []) or []:
                node(c)
    for k in ("bookmark_bar", "other", "synced"):
        node(o["roots"][k])
    return md5.hexdigest()

chk(cksum(new) == new.get("checksum"), f"checksum 可复现 ({new.get('checksum')})")

# --- 4. 零数据丢失：清理后的 URL 集合必须覆盖原文件全部唯一 URL ---
def norm(u):
    u = u.strip().rstrip("/")
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    u = re.sub(r"[?&](utm_[^&]*|fromscen[^&]*|data_source=[^&]*)$", "", u)
    return u.lower()

def collect(o):
    s = []
    def walk2(node):
        for c in node.get("children", []) or []:
            if c.get("type") == "url":
                s.append(c["url"])
            else:
                walk2(c)
    for k in ("bookmark_bar", "other", "synced"):
        if o["roots"].get(k):
            walk2(o["roots"][k])
    return s

old_u = {norm(u) for u in collect(orig) if u}
new_u = {norm(u) for u in urls if u}
missing = old_u - new_u
extra = new_u - old_u
chk(not missing, f"无丢失：原有 {len(old_u)} 个唯一网址全部保留 (丢失 {len(missing)})")
if missing:
    for m in list(missing)[:10]:
        R.append("        缺失 -> " + m)
chk(not extra, f"无凭空新增 (多余 {len(extra)})")

# --- 5. 去重彻底性 ---
dupurl = [k for k, v in collections.Counter([norm(u) for u in urls]).items() if v > 1]
chk(not dupurl, f"清理后无重复网址 (重复 {len(dupurl)})")
for d in dupurl[:5]:
    R.append("        重复 -> " + d)

# --- 6. 标题质量 ---
ZWRE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]")

def _clean(s):
    return ZWRE.sub("", "".join(ch for ch in (s or "")
                   if unicodedata.category(ch) != "Cf")).strip()

orig_leaves = []
def _walk_o(node):
    for c in node.get("children", []) or []:
        if c.get("type") == "url":
            orig_leaves.append(c.get("name") or "")
        else:
            _walk_o(c)
for _k in ("bookmark_bar", "other", "synced"):
    _walk_o(orig["roots"][_k])

orig_blank = sum(1 for x in orig_leaves if not _clean(x))
orig_zw = sum(1 for x in orig_leaves if ZWRE.search(x))

blank = [c for c in leaves if not _clean(c.get("name") or "")]
chk(not blank, f"无空白标题 (原始 {orig_blank} 条，剩余 {len(blank)})")
zw = [c for c in leaves if ZWRE.search(c.get("name") or "")]
chk(not zw, f"无零宽/格式控制字符残留 (原始 {orig_zw} 条被污染，剩余 {len(zw)})")

# --- 7. 无残留导入文件夹 ---
imp = []
def find_imp(node, path):
    for c in node.get("children", []) or []:
        if c.get("type") == "folder":
            if "导入" in (c.get("name") or ""):
                imp.append(path + "/" + c["name"])
            find_imp(c, path + "/" + c.get("name", ""))
for k in ("bookmark_bar", "other", "synced"):
    find_imp(new["roots"][k], k)
chk(not imp, f"「从…导入」残留文件夹已清除 (残留 {len(imp)})")

R.append("")
R.append("=" * 68)
R.append(f"总结论: {'全部通过 ✔ 可以安装' if ok_all[0] else '存在未通过项 ✘ 请勿安装'}")
R.append(f"  原始书签 {len(collect(orig))} -> 清理后 {len(leaves)} (唯一网址 {len(new_u)})")
R.append(f"  最大深度 {maxdepth[0]} 层, Top 文件夹 {len(new['roots']['bookmark_bar']['children'])} 个")
R.append("=" * 68)

open(os.path.join(W, "validate_report.txt"), "w", encoding="utf-8").write("\n".join(R))
print("\n".join(R))
print("\nPASS" if ok_all[0] else "\nFAIL")
