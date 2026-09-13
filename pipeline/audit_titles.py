# -*- coding: utf-8 -*-
"""核实「空白标题」与「被改写标题」的真实数量，避免报告口径误导"""
import json, os, re, unicodedata

W = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
orig = json.load(open(os.path.join(W, "Bookmarks.original.json"), encoding="utf-8"))
new = json.load(open(os.path.join(W, "Bookmarks.cleaned.json"), encoding="utf-8"))

ZW = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]")

def clean(s):
    return ZW.sub("", "".join(ch for ch in (s or "") if unicodedata.category(ch) != "Cf")).strip()

def collect(o):
    out = []
    def w(n):
        for c in n.get("children", []) or []:
            if c.get("type") == "url":
                out.append(c.get("name") or "")
            else:
                w(c)
    for k in ("bookmark_bar", "other", "synced"):
        w(o["roots"][k])
    return out

o_names, n_names = collect(orig), collect(new)

def seen(names):
    s = {}
    for x in names:
        s[x] = s.get(x, 0) + 1
    return s

L = []
a = L.append
a("=" * 64)
a("标题质量真实口径核实")
a("=" * 64)
a(f"原始书签节点数          : {len(o_names)}")
a("")
a(f"[A] 清洗后完全为空       : {sum(1 for x in o_names if not clean(x))}")
a(f"[B] 含零宽/格式控制字符   : {sum(1 for x in o_names if any(unicodedata.category(c)=='Cf' for c in x))}")
a(f"[C] 清洗后长度 <= 3      : {sum(1 for x in o_names if len(clean(x)) <= 3)}   <-- 之前报告里的 56 就是这个口径")
a(f"[D] 清洗后长度 > 60      : {sum(1 for x in o_names if len(clean(x)) > 60)}")
a("")
a("之前报告写的「56 条空白标题」= 口径 [C]，其中大部分是 OZON / MY / 扣子 / 挡泥板 这类正常短标题，")
a("并非真的空白。真正的空白是 [A]，数量远小于 56。")
a("")
a("--- [C] 口径下的题目样本（前 25 个）---")
c3 = [clean(x) for x in o_names if len(clean(x)) <= 3]
for t in c3[:25]:
    a(f"    「{t}」")
a("")
a("--- 整理后被改名的标题（生成结果 vs 原始，按唯一名比对）---")
o_set, n_set = set(o_names), set(n_names)
added = [x for x in n_set if x not in o_set]
a(f"新增/改写的标题共 {len(added)} 个（含去重后保留的规范名）：")
for t in sorted(added)[:40]:
    a(f"    {t}")
a("")
a("=" * 64)

open(os.path.join(W, "title_audit.txt"), "w", encoding="utf-8").write("\n".join(L))
print("\n".join(L))
