import os, datetime, glob

base = os.path.join(os.environ["LOCALAPPDATA"], "Microsoft", "Edge", "User Data")
OUT = r"C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work\sync_state.txt"
R = []
def w(s=""):
    R.append(s)

EPOCH = datetime.datetime(1601, 1, 1)
def conv(us):
    try:
        return (EPOCH + datetime.timedelta(microseconds=int(us))).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "?"

w("=" * 60)
w(" 同步时间点换算（Chromium 时间戳 = 1601 起微秒）")
w("=" * 60)
pairs = [
    ("上次成功同步 last_synced_time", "13433185972136572"),
    ("上次轮询 last_poll_time",       "13433179918672379"),
    ("同步暂停起点 sync_paused_start_time", "13433645497340293"),
]
now = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
w(f"当前时间(北京) = {now.strftime('%Y-%m-%d %H:%M:%S')}")
w("")
for name, v in pairs:
    d = conv(v)
    w(f"  {name}")
    w(f"    {v}  ->  {d} UTC+0")

w("")
w("=" * 60)
w(" 同步诊断日志（末尾）")
w("=" * 60)
for f in glob.glob(os.path.join(base, "Default", "Sync Data", "Logs", "*.log")):
    try:
        txt = open(f, encoding="utf-8", errors="replace").read()
    except Exception as e:
        w(f"{os.path.basename(f)}: 读取失败 {e}")
        continue
    w("")
    w(f"--- {os.path.basename(f)}  ({len(txt)} chars) ---")
    for line in txt.strip().splitlines()[-14:]:
        w("  " + line[:220])

open(OUT, "w", encoding="utf-8").write("\n".join(R))
