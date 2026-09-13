# 运行 AI 链路端到端测试
# 做法：把插件源码复制到临时目录并改名为 .mjs（这样 Node 才能直接 import 这些 ES 模块），
#       再把内部的相对导入路径同步改名，最后用真实书签数据跑 test_ai.mjs。
# 注意：本文件含中文，必须以 UTF-8 带 BOM 保存，否则 Windows PowerShell 5.1 会按 GBK 解析而报错。
$ErrorActionPreference = 'Stop'

$EXT = "C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\ozon-bookmark-manager"
$W   = "C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
$BK  = Join-Path $W "Bookmarks.cleaned.json"
$NODE = "C:\Users\yangzhiheng\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
$TMP = Join-Path $env:TEMP "ai_e2e"

Remove-Item $TMP -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $TMP | Out-Null

# 单文件模块：直接改名即可
foreach ($pair in @(
  @("rules.js",   "rules.mjs"),
  @("shared.js",  "shared.mjs"),
  @("tidy.js",    "tidy.mjs"),
  @("ai\client.js",  "client.mjs"),
  @("ai\prompts.js", "prompts.mjs"),
  @("ai\provider.js","provider.mjs"),
  @("ai\store.js",   "store.mjs"),
  @("ai\planner.js", "planner.mjs"),
  @("ai\apply.js",   "apply.mjs")
)) {
  $src = Join-Path $EXT $pair[0]
  $dst = Join-Path $TMP $pair[1]
  if (-not (Test-Path $src)) { Write-Host "MISSING: $src"; continue }
  (Get-Content $src -Raw -Encoding UTF8) `
    -replace "\.\./rules\.js",  "./rules.mjs" `
    -replace "\.\./tidy\.js",   "./tidy.mjs" `
    -replace "\./shared\.js",   "./shared.mjs" `
    -replace "\./provider\.js", "./provider.mjs" `
    -replace "\./client\.js",   "./client.mjs" `
    -replace "\./prompts\.js",  "./prompts.mjs" `
    -replace "\./store\.js",    "./store.mjs" `
    | Set-Content $dst -Encoding UTF8
}

Copy-Item (Join-Path $EXT "dev\test_ai.mjs") (Join-Path $TMP "test_ai.mjs") -Force

Write-Host "--- 语法检查（ESM）---"
$bad = 0
foreach ($f in (Get-ChildItem $TMP -Filter *.mjs | Where-Object { $_.Name -ne 'test_ai.mjs' })) {
  & $NODE --check $f.FullName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host ("  [FAIL] " + $f.Name); $bad++ } else { Write-Host ("  [OK]   " + $f.Name) }
}

Write-Host ""
Write-Host "--- 运行端到端测试 ---"
& $NODE (Join-Path $TMP "test_ai.mjs") $BK
$code = $LASTEXITCODE
Write-Host "test_exit=$code"

# 把结果落回 dev 目录
$res = Join-Path $TMP "ai_test_result.txt"
if (Test-Path $res) { Copy-Item $res (Join-Path $EXT "dev\ai_test_result.txt") -Force }
exit $code
