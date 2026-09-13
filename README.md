# 收藏夹管家 · Bookmark Butler

> 用**你自己的**大模型整理浏览器收藏夹：自动分析你现有的书签，归纳出贴合你业务的分类体系，一键归位。
> 不想联网时，也可以纯本地规则离线跑。**只移动、从不删除。**

一个 Chromium 浏览器扩展（Manifest V3）+ 一套离线整理流水线。适用于 Edge / Chrome / Brave 等所有 Chromium 内核浏览器。

---

## 它解决什么问题

浏览器收藏夹失控通常不是「懒得整理」，而是**结构性故障**：

| 症状 | 真实原因 |
|---|---|
| 同一个网站存了 5~6 份 | 反复「从 XX 导入」，每次导入都复制了一整棵完整的收藏栏树 |
| 收藏栏上平铺几十上百条散书签 | 顺手 Ctrl+D 的条目从未归位 |
| 有些书签标题显示为空 | 标题里混进了零宽字符（U+200B 等），浏览器渲染不出来 |
| 想找「那个 ERP」却想不起在哪 | 分类跟着「当初怎么存的」走，而不是跟着「业务怎么用的」走 |

本项目先做**一次性外科手术**把地基清干净，再用扩展长期接管日常。

---

## 两部分组成

### 1. `extension/` — 浏览器扩展

- **AI 智能整理**：把书签摘要交给大模型，由模型从你的数据里**归纳**分类体系（而不是套用写死的规则），再逐域归位。
  - 三阶段流水线：**按域名聚合 → 归纳体系 → 域名级归位 → 一域多用途逐条细判 → 兜底复核**
  - 386 条书签 → 约 120 个域名 → 摘要 ≈3.5k tokens，成本可控
  - 生成的方案**先预览、后执行**，执行后可**一键撤销**
- **秒级搜索**：跨标题 / 网址 / **备注** / **标签**搜索。备注以网址为键存储，**书签删了重加，备注还在**
- **规则整理**：纯本地、纯数据驱动的分类规则表（`rules.js`），离线可用、可编辑、可试算命中率
- **重复清理 / 标题修复 / 导入残留清理**：逐组确认，只移动不删除

### 2. `pipeline/` — 离线整理流水线

Python + PowerShell 写的「脚本化手术刀」，适合一次性根治：

| 脚本 | 作用 |
|---|---|
| `analyze.py` | 诊断：结构、深度、重复来源定位、命名质量（**长度指标先剥零宽字符再算**） |
| `dig.py` | 深挖重复是从哪几个「导入」文件夹冒出来的 |
| `clean.py` | 清理：去重 + 业务域重建 + 标题修复 + **checksum 重算** |
| `validate.py` | 校验：结构合法性、ID/GUID 唯一、**零数据丢失**、checksum 自洽 |
| `audit_titles.py` | 标题质量口径核实（修正「看起来空白」的误报） |
| `apply_now.ps1` | 安全安装：抗 Edge「启动增强」自动复活，`kill → 原子替换 → 再 kill` |
| `rollback.ps1` | 一键回滚（同款健壮性） |
| `live_verify.py` | 核对浏览器里**正在生效**的那份文件 |
| `sync_check.py` / `sync_state.py` | 检查账号同步状态（决定云端会不会把垃圾推回来） |

> ⚠️ `pipeline/` 里**不含任何真实书签数据**。`Bookmarks` 本体、`backup/`、`logs/` 等都在 `.gitignore` 里。

---

## 快速开始

### 方式一：装上扩展（推荐）

1. 打开 `chrome://extensions` 或 `edge://extensions`
2. 右上角打开 **开发者模式**
3. 点 **加载解压缩的扩展**，选择 `extension/` 目录
4. 点扩展图标 → **AI 智能整理** → 模型配置 → 填**你自己的** API Key

也可以直接用 `releases/bookmark-butler-v1.1.0.zip`：解压后按上面步骤加载。

### 方式二：离线清理（不需要 Key、不联网）

```powershell
# 1. 完全退出浏览器（脚本会自动处理“启动增强”导致的进程复活）
# 2. 先诊断
python pipeline/analyze.py
# 3. 生成整理后的文件（产出 Bookmarks.cleaned.json，不会动你的原文件）
python pipeline/clean.py
# 4. 校验：结构合法 / 零丢失 / checksum 自洽
python pipeline/validate.py
# 5. 安装（自动备份到 Bookmarks.manualbak，可随时回滚）
powershell -ExecutionPolicy Bypass -File pipeline/apply_now.ps1
# 后悔了？
powershell -ExecutionPolicy Bypass -File pipeline/rollback.ps1
```

### 方式三：AI 智能整理

在扩展里点 **AI 智能整理**，四步向导：

1. **确认模型** — 选服务商、填 Key、测试连接
2. **扫描与隐私** — 看到将发送什么，确认后才发
3. **生成方案** — 实时进度、可取消、显示 token 用量与预估成本
4. **预览执行** — 逐项确认后执行；不满意点「撤销本次整理」

---

## 支持的模型服务商

内置预设（统一走 OpenAI 兼容协议，开箱即用）：

DeepSeek · OpenAI · Kimi（Moonshot）· 通义千问（DashScope）· 智谱 GLM · 硅基流动 · OpenRouter · Ollama（本地）

也支持**任意自定义端点**——自定义地址通过 Chrome 的「可选权限」机制在你点击保存时申请，权限面保持最小。

### 关于 API Key（重要）

- Key 存在 `chrome.storage.local`，**刻意不使用 `storage.sync`**（sync 会把 Key 上传到云端账号）
- Key **只从你的浏览器直接发往模型厂商**，不经过任何中间服务器
- 界面**永不回显完整 Key**，只显示掩码
- 想彻底不出本机：选 **Ollama**，跑本地模型

### 隐私

- 默认只发送**域名 + 标题**，不发送完整 URL（需显式勾选才会发；卡片中会警告 URL 可能带 token / 订单号）
- 发送前可展开「将发送的摘要」**原文核对**
- 全程可取消；执行可撤销；**只移动，从不删除**

---

## 目录结构

```
bookmark-butler/
├── extension/                 浏览器扩展（Manifest V3）
│   ├── ai/                    AI 能力层
│   │   ├── provider.js        服务商预设 / 自定义端点 / 可选权限申请
│   │   ├── store.js           配置存储（storage.local，Key 掩码）
│   │   ├── client.js          Chat 客户端：重试 / 退避 / 超时 / 取消 / JSON 修复
│   │   ├── prompts.js         三阶段提示词
│   │   ├── planner.js         规划流水线（纯逻辑，不依赖 chrome API）
│   │   └── apply.js           执行层 + 操作日志 + 一键撤销
│   ├── ai.html/css/js         AI 整理台（四步向导 + 模型配置 + 使用说明）
│   ├── popup.html/css/js      弹窗：秒级搜索
│   ├── manager.html/css/js    管理台：总览 / 整理 / 查重 / 标签备注 / 规则
│   ├── rules.js               数据化规则引擎（可编辑）
│   ├── shared.js              书签读取、URL 归一化、统计
│   ├── tidy.js                本地规则执行层
│   └── dev/                   开发与测试（测试桩、mock 服务端、打包脚本）
├── pipeline/                  离线整理流水线（见上表）
├── docs/                      经验沉淀与技术笔记
└── releases/                  可直接分发的安装包
```

---

## 开发与测试

### 无 API Key 也能完整验证 AI 链路

`extension/dev/test_ai.mjs` 会起一个**本地 OpenAI 兼容 mock 服务端**，并注入四种真实故障：

- `401` 鉴权失败
- `429` 限流（验证指数退避重试）
- ```` ```json ```` 围栏包裹（验证 JSON 抽取）
- JSON 被截断（验证 `repairTruncatedJson` 补收尾）

再配一个**内存版 `chrome.bookmarks` 桩**，用真实书签数据跑通
「摘要 → 归纳 → 归类 → 对齐 → 执行 → 撤销」全链路。

```powershell
powershell -ExecutionPolicy Bypass -File extension/dev/run_test_ai.ps1
```

`extension/dev/test_pipeline.mjs` 则对本地规则引擎做端到端校验。

### 打包给朋友

```powershell
powershell -ExecutionPolicy Bypass -File extension/dev/pack.ps1
```

会排除 `dev/`（其中含真实书签样例）、日志与测试产物，并自动摘掉 HTML 里对调试垫片的引用。
**脚本内置防泄漏自检：一旦发现 `dev/` 或样例文件混入，会直接中止打包。**

### 在普通浏览器里预览管理台界面

`extension/dev/mock-chrome.js` 提供了一个 `chrome.*` API 垫片：用普通浏览器直接打开
`manager.html` / `ai.html` 即可预览完整界面（演示模式走本地逻辑，不联网、不要 Key）。
在真实的扩展环境里，垫片会自动失效（no-op）。

> 注意：ES 模块在 `file://` 下会被 CORS 拦截，本地预览请起一个静态服务器。

---

## 已知限制

- 仅在 Chromium 内核浏览器验证（Edge / Chrome）。Firefox 的 `bookmarks` API 有差异，未适配。
- AI 整理的质量取决于所用模型与你的书签质量；模型不可用时自动降级到本地规则。
- 一个域名多种用途（如既是对手店铺页、又是类目调研页）只能逐条判断，会产生额外 token 消耗。
- 离线流水线的安装脚本仅支持 Windows（依赖 PowerShell 与 NTFS 原子替换）。

---

## 许可

MIT，见 [LICENSE](LICENSE)。

---

## 延伸阅读

- [`docs/01-收藏夹清理实录.md`](docs/01-收藏夹清理实录.md) — 778 → 386 的完整过程与根因分析
- [`docs/02-Chromium收藏夹文件技术笔记.md`](docs/02-Chromium收藏夹文件技术笔记.md) — Bookmarks 文件格式、checksum、同步语义、安全写入
- [`docs/03-浏览器扩展接入大模型工程实践.md`](docs/03-浏览器扩展接入大模型工程实践.md) — Key 存储、提示词流水线、无 Key 测试方法
