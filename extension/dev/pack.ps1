# 打包成可直接转发给朋友的扩展包
#   - 排除 dev/ 目录（里面含开发用脚本和真实书签样例，不能外发）
#   - 排除日志与测试结果
#   - 去掉 ai.html / manager.html 里对 dev/ 调试垫片的引用
# 产物：dist\收藏夹管家-AI整理版-v<版本>.zip
# 本文件含中文，须以 UTF-8 带 BOM 保存。
$ErrorActionPreference = 'Stop'

$EXT  = "C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\ozon-bookmark-manager"
$DIST = Join-Path $EXT "dist"
$STG  = Join-Path $env:TEMP "ext_pack"

$manifest = Get-Content (Join-Path $EXT "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = $manifest.version
$zipName = "收藏夹管家-AI整理版-v$ver.zip"

# 1) 清空并复制（排除 dev / dist / 日志 / 测试产物）
Remove-Item $STG -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $STG | Out-Null

Get-ChildItem $EXT -Force | Where-Object {
  $_.Name -notin @('dev', 'dist', 'logs')
} | ForEach-Object {
  if ($_.PSIsContainer) { Copy-Item $_.FullName (Join-Path $STG $_.Name) -Recurse -Force }
  else { Copy-Item $_.FullName (Join-Path $STG $_.Name) -Force }
}
# 清掉可能混入的日志/测试文件
Get-ChildItem $STG -File -Recurse |
  Where-Object { $_.Extension -in @('.log') -or $_.Name -like '*_result.txt' -or $_.Name -like 'syntax_*' } |
  Remove-Item -Force -ErrorAction SilentlyContinue

# 2) 去掉对 dev/ 调试垫片的引用（打包后不存在该目录）
foreach ($h in @('ai.html', 'manager.html')) {
  $p = Join-Path $STG $h
  if (-not (Test-Path $p)) { continue }
  $lines = Get-Content $p -Encoding UTF8 | Where-Object { $_ -notmatch 'dev/mock-(data|chrome)\.js' }
  $lines | Set-Content $p -Encoding UTF8
}

# 3) 自检：确认包里没有 dev、没有测试产物、没有真实书签样例
$leak = Get-ChildItem $STG -Recurse -File |
  Where-Object { $_.FullName -match '\\dev\\' -or $_.Name -match 'mock-data|test_ai|ai_test_result' }
if ($leak) {
  Write-Host "[中止] 打包目录中仍存在不应外发的文件："
  $leak | ForEach-Object { Write-Host "   " + $_.FullName.Replace($STG, '') }
  exit 1
}

# 4) 压缩
New-Item -ItemType Directory -Force -Path $DIST | Out-Null
$zip = Join-Path $DIST $zipName
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $STG '*') -DestinationPath $zip -CompressionLevel Optimal

Write-Host "打包完成："
Write-Host "  $zip"
Write-Host "  大小 " + [math]::Round((Get-Item $zip).Length / 1KB, 1) + " KB"
Write-Host ""
Write-Host "包含文件："
Get-ChildItem $STG -Recurse -File | ForEach-Object { Write-Host "  " + $_.FullName.Replace($STG + '\', '') }
