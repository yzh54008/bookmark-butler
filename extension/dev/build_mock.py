# -*- coding: utf-8 -*-
"""把 Bookmarks.cleaned.json 转成 dev/mock-data.js，供浏览器里直接预览管理台 UI"""
import json, os

W = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
DST = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\ozon-bookmark-manager\dev\mock-data.js"

with open(os.path.join(W, "Bookmarks.cleaned.json"), encoding="utf-8") as f:
    data = json.load(f)

# 构造一个 Chromium bookmarks.getTree() 形状的根节点
root = {
    "id": "0",
    "title": "",
    "children": [],
}
for k in ("bookmark_bar", "other", "synced"):
    n = data["roots"][k]
    root["children"].append({
        "id": n["id"],
        "parentId": "0",
        "title": n["name"],
        "dateAdded": int(n.get("date_added") or 0),
        "children": n.get("children", []),
    })

payload = json.dumps(root, ensure_ascii=False, separators=(",", ":"))

with open(DST, "w", encoding="utf-8") as f:
    f.write("// 由 build_mock.py 从 Bookmarks.cleaned.json 自动生成，仅供预览使用\n")
    f.write("window.__DEMO_TREE = " + payload + ";\n")

print("OK bytes=%d" % len(payload))
