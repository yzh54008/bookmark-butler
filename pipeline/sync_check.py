import json, os, glob

base = os.path.join(os.environ["LOCALAPPDATA"], "Microsoft", "Edge", "User Data")
OUT = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work\sync_check.txt"
R = []
def w(s=""):
    R.append(s)

def load(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception as e:
        return {"__err__": str(e)}

pref = load(os.path.join(base, "Default", "Preferences"))
local = load(os.path.join(base, "Local State"))

w("=" * 60)
w(" Edge 账户与同步状态")
w("=" * 60)

acct = pref.get("account_info") or []
w(f"已登录账户数 = {len(acct)}")
for a in acct:
    w(f"  - {a.get('email','?')}  full_name={a.get('full_name','')}  "
      f"gaia={str(a.get('gaia',''))[:12]}...  id={str(a.get('account_id',''))[:12]}...")

w("")
w("--- 同步相关偏好键 ---")
found = False
def scan(obj, prefix=""):
    global found
    if isinstance(obj, dict):
        for k, v in obj.items():
            kp = f"{prefix}.{k}" if prefix else k
            if "sync" in k.lower() and not isinstance(v, (dict, list)):
                w(f"  {kp} = {v}")
                found = True
            elif "sync" in k.lower() and isinstance(v, dict) and len(v) < 12:
                w(f"  {kp} = {json.dumps(v, ensure_ascii=False)[:180]}")
                found = True
            scan(v, kp)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:5]):
            scan(v, f"{prefix}[{i}]")

scan(pref)
if not found:
    w("  （Preferences 里没有显式的 sync 开关）")

w("")
w("--- 同步数据库 ---")
sd = os.path.join(base, "Default", "Sync Data")
w(f"Sync Data 目录: {'存在' if os.path.isdir(sd) else '不存在'}")
if os.path.isdir(sd):
    for p in glob.glob(os.path.join(sd, "**", "*"), recursive=True):
        if os.path.isfile(p):
            w(f"  {os.path.relpath(p, sd)}  {os.path.getsize(p)} bytes")

w("")
w("--- 书签同步相关：Edge 是否记录 sync 账号 ---")
w(f"Local State 里 signin 相关键:")
for k in local.keys():
    if any(s in k.lower() for s in ("signin", "sync", "profile")):
        v = local[k]
        w(f"  {k} = {json.dumps(v, ensure_ascii=False)[:200]}")

w("")
w("--- 判断 ---")
if len(acct) == 0:
    w("  未登录 Microsoft 账户 → 收藏夹只在本地，不存在云端回灌风险 ✓")
else:
    w("  已登录账户。收藏夹同步若开启，删除操作会按 GUID 同步到服务器；")
    w("  因本次保留了原始 GUID，被删的 392 条会作为删除事件上行，不会回灌。")
    w("  但首次启动时 Edge 可能与服务器做一次合并，建议先观察一次。")

open(OUT, "w", encoding="utf-8").write("\n".join(R))
