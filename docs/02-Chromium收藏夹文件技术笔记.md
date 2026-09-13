# Chromium 收藏夹文件技术笔记

在改写浏览器收藏夹文件之前，必须弄清楚这几件事。踩错一步就是把用户的收藏夹判为「损坏」。

---

## 一、文件在哪

```
Windows:  %LOCALAPPDATA%\<厂商>\<浏览器>\User Data\<Profile>\Bookmarks
macOS:    ~/Library/Application Support/<厂商>/<浏览器>/<Profile>/Bookmarks
Linux:    ~/.config/<厂商>/<浏览器>/<Profile>/Bookmarks
```

- Edge → `Microsoft\Edge`
- Chrome → `Google\Chrome`
- Profile 目录通常是 `Default`，多用户时是 `Profile 1`、`Profile 2`…

同目录下还有 `Bookmarks.bak`（浏览器自己的上次备份，不要误当成你的备份）。

**先复制出来再离线分析，绝不要直接操作原文件。**

---

## 二、JSON 结构

```jsonc
{
  "checksum": "7c77d6510dbbd9ca16ea45238c0c3cce",
  "roots": {
    "bookmark_bar": { "children": [ /* ... */ ], "date_added": "133...", "date_modified": "133...",
                      "guid": "...", "id": "1", "name": "收藏夹栏", "type": "folder" },
    "other":        { /* 其他收藏夹 */ },
    "synced":       { /* 移动设备书签 */ }
  },
  "version": 1
}
```

节点只有两种类型：

```jsonc
// 文件夹
{ "children": [...], "date_added": "...", "date_last_used": "...",
  "guid": "...", "id": "12", "name": "01 · OZON运营", "type": "folder" }

// 书签
{ "date_added": "...", "date_last_used": "...", "guid": "...", "id": "34",
  "name": "卖家后台", "show_icon": false, "source": "sync", "type": "url",
  "url": "https://seller.ozon.ru/", "visit_count": 3 }
```

几个容易踩的点：

- **`id` 是字符串形式的整数**，全局唯一、必填
- **`name` 不是 `title`** —— 文件里叫 `name`，但 `chrome.bookmarks` API 返回的是 `title`。
  写测试夹具时字段名必须递归转换，否则会出现「深层节点标题全空」的假 bug
- **`date_added` 是自 1601-01-01 起的微秒数**（Windows FILETIME 口径），字符串存储
- `guid` 是同步实体标识，见下节
- 根节点的 `id` 固定：`bookmark_bar` 是 `"1"`、`other` 是 `"2"`、`synced` 是 `"3"`

---

## 三、checksum

### 算法

Chromium 用 MD5 逐节点累积。**顺序是固定的**：

```
对每个节点依次喂入：
  1. id                     （十进制字符串的字节）
  2. title                  （UTF-16 原始字节，即每个 char16_t 的 2 字节小端表示）
  3. 节点类型标记             （url 节点 / folder 节点）
  4. url                    （仅 url 节点，possibly_invalid_spec() 的字节）
然后按 children 顺序，对每个子节点递归重复以上步骤

根节点遍历顺序：bookmark_bar → other → synced
```

关键细节是**第 2 步**：标题不是按 UTF-8 喂进去的，而是按 UTF-16 的**原始字节**。等价写法：

```python
md5.update(title.encode("utf-16-le"))   # 不带 BOM
```

### 但是：Chromium 解码时不校验它

去翻了 `components/bookmarks/browser/bookmark_codec.cc` 的实现——
当前版本的 `Decode()` 路径**不消费 `checksum` 字段**，也就是说校验和不匹配
**不会**导致收藏夹被判为损坏。

**那为什么还要算？**

1. 不依赖「当前版本恰好不校验」这个实现细节 —— 哪天改了就会翻车
2. 其他工具（同步服务、第三方管理器、旧版本浏览器）可能会校验
3. 成本极低，没有不算的理由

---

## 四、`guid` = 同步实体标识

这是**决定同步会不会把垃圾推回来**的关键。

Chromium 的同步引擎用 `guid` 作为书签实体的稳定标识。原始文件里
**没有 `meta_info` 字段**，说明这个 profile 走的就是纯 `guid` 通道。

### 实际后果

假设你删掉了 392 条重复书签，如果：

- **保留了幸存条目的原始 `guid`** → 同步引擎看到「本地有、云端有」→ 无操作；
  而「云端有、本地没有」的那 392 条会被识别为**本地删除**，**上行**推送删除事件。
  ✅ 云端垃圾被清掉。

- **给所有条目重新生成了 `guid`** → 同步引擎看到「本地全新的一批 + 云端旧的一批」
  → 可能触发**双向合并**，把 392 条垃圾**拉回来**。
  ❌ 白干。

**所以：去重时必须保留原始 `guid`，只改结构与父子关系。**

### 怎么查同步状态

```powershell
# 账户信息与同步开关
#   Default\Preferences 里的 sync.* 字段
# 同步诊断日志
#   Default\Sync Data\ 下的日志，会明确报 Stopped / 错误码
```

如果同步处于**停用状态**（例如登录凭证失效，日志里报 `EDGE_AUTH_ERROR`），
那么本地改动**不会**被云端覆盖，也不会有回灌风险——但云端仍存着旧版，
等用户重新登录恢复同步时才会同步上去。

---

## 五、安全写入的三条铁律

### 铁律 1：先退出浏览器

浏览器持有内存态，它在关闭时会把内存里的书签树写回文件。你的改动会被静默覆盖。

### 铁律 2：它会自动复活 —— 必须抢时间窗

Edge / Chrome 的「启动增强」在注册表里注册了自启项：

```
HKCU\Software\Microsoft\Windows\CurrentVersion\Run\MicrosoftEdgeAutoLaunch_<hash>
    = msedge.exe --no-startup-window --win-session-start
```

进程被结束后会被**自动重新拉起**。所以正确做法是在一个脚本里完成
`kill → 原子替换 → 再 kill`，并用 `File.Replace()` 做 NTFS 原子操作。

`File.Replace(source, destination, backup)` 一次调用同时完成：替换 + 自动备份原文件。
比 `Copy-Item` 安全得多（后者不是原子的，中途失败会留下半截文件）。

### 铁律 3：回滚路径要真跑一遍

只写不测的回滚脚本等于没有回滚脚本。**做一次真实往返**：
回滚 → 条数恢复 → 重新安装 → 条数正确。两个方向都要验证。

---

## 六、如何判断浏览器「真的」关掉了

别数进程数。一个人说「我关了浏览器」，但后台可能还有 10 个进程——
那是「关闭窗口后继续后台运行」，**这种情况杀进程是零损失的**。

真正的判据（三者同时成立）：

```powershell
$p = Get-Process msedge -ErrorAction SilentlyContinue

# 1) 没有任何可见主窗口
($p | Where-Object { $_.MainWindowHandle -ne 0 }).Count -eq 0

# 2) 主进程是纯后台模式
#    命令行含 --no-startup-window
$procs = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"
$procs.CommandLine -match '--no-startup-window'

# 3) 没有待恢复的会话
Test-Path "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Last Session"  # 应为 False
```

另外，文件独占锁测试是最干净的验证方式——能独占打开就说明没有进程占用它：

```powershell
$fs = [System.IO.File]::Open($bk, 'Open', 'ReadWrite', 'None')   # 抛异常 = 被占用
$fs.Close()
```

> ⚠️ `msedgewebview2.exe` 是**其他软件**内嵌的 WebView 运行时（父进程是那个软件，不是浏览器），
> **不要动它**。

---

## 七、写完之后的验证清单

不要凭「脚本退出码是 0」就宣布成功。逐项核验：

| 检查项 | 方法 |
|---|---|
| 文件能被解析 | `json.load()` 不报错 |
| **与成品逐条一致** | 比对正在生效的文件 vs 已校验的产物，逐条比 `id + guid + url + title` |
| 数量正确 | 递归计数 = 预期值 |
| 零丢失 | 去重后唯一 URL 集合 ⊆ 原始唯一 URL 集合，且大小相等 |
| 零新增 | 反之亦然 |
| 无重复 | 归一化 URL 分组后每组大小 = 1 |
| ID / GUID 全局唯一 | 收集所有 id、所有 guid，`len(set()) == len(list)` |
| 结构合法 | 每个节点有 `type`、有 `id`、folder 有 `children`、url 有 `url` |
| 深度封顶 | 递归求最大深度 ≤ 设定值 |
| checksum 自洽 | 按官方算法重算，与写入值相同 |
| **稳定性** | 安装后隔几秒连续采样若干次，确认 md5 未被浏览器改写回去 |
