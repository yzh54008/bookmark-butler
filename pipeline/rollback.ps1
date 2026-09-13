# 回滚 Edge 收藏夹到整理前状态（778 条原始版本）
# 与安装脚本同款健壮性：结束进程 -> 原子替换 -> 校验，可对抗 Edge「启动增强」自动重启
# 注：本文件须以 UTF-8 带 BOM 保存，否则 Windows PowerShell 5.1 会按 ANSI 解析导致乱码
$ErrorActionPreference = 'Stop'

$W          = "C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
$profileDir = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Default"
$target     = Join-Path $profileDir "Bookmarks"
$backupDir  = Join-Path $W "backup"
$expectMd5  = "80888B1F3A89B7909CDCE63904F974AB"   # 原始 778 条版本的 md5

function Say($m) { Write-Host $m }

function Stop-Edge {
    for ($i = 0; $i -lt 12; $i++) {
        $p = Get-Process -Name msedge -ErrorAction SilentlyContinue
        if (-not $p) { return 0 }
        foreach ($pr in $p) { try { Stop-Process -Id $pr.Id -Force -ErrorAction Stop } catch {} }
        Start-Sleep -Milliseconds 350
    }
    return (Get-Process -Name msedge -ErrorAction SilentlyContinue | Measure-Object).Count
}

function Count-Leaves($path) {
    $obj = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $n = 0
    $stack = New-Object System.Collections.Stack
    foreach ($k in @('bookmark_bar','other','synced')) {
        foreach ($c in $obj.roots.$k.children) { $stack.Push($c) }
    }
    while ($stack.Count -gt 0) {
        $node = $stack.Pop()
        if ($node.type -eq 'url') { $n++ }
        elseif ($node.children) { foreach ($x in $node.children) { $stack.Push($x) } }
    }
    return $n
}

Say "=============================================="
Say " Edge 收藏夹 - 回滚到整理前"
Say "=============================================="

# 备份来源：profile 内的手动备份优先，其次时间戳备份
$src = "$target.manualbak"
if (-not (Test-Path $src)) {
    $cand = Get-ChildItem $backupDir -Filter "Bookmarks.*.json" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notlike "Bookmarks.bak.*" } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($cand) { $src = $cand.FullName }
}
if (-not $src -or -not (Test-Path $src)) { throw "找不到可用的备份文件" }

$srcMd5 = (Get-FileHash $src -Algorithm MD5).Hash
Say "备份来源: $src"
Say "  大小 = $((Get-Item $src).Length) bytes   md5 = $srcMd5"
if ($srcMd5 -ne $expectMd5) {
    Say ""
    Say "[警告] 备份文件的 md5 与已知的原始版本不一致。"
    Say "       期望 $expectMd5"
    Say "       如果你确认这就是想恢复的版本，请手动复制该文件到："
    Say "       $target"
    exit 2
}

$ok = $false
for ($attempt = 1; $attempt -le 6; $attempt++) {
    $left = Stop-Edge
    if ($left -ne 0) { Say "[1/2] 第 $attempt 次：仍有 $left 个 msedge 进程，重试" ; continue }
    $tmp = Join-Path $profileDir "Bookmarks.wbbak"
    Copy-Item $src $tmp -Force
    try { [System.IO.File]::Replace($tmp, $target, $null) }
    catch { try { Move-Item $tmp $target -Force } catch { Say "      替换失败: $($_.Exception.Message)" } }
    if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    if ((Get-FileHash $target -Algorithm MD5).Hash -eq $expectMd5) {
        Say "[1/2] 第 $attempt 次：回滚成功"
        $ok = $true; break
    }
    Say "[1/2] 第 $attempt 次：哈希不符，重试"
    Start-Sleep -Milliseconds 800
}
if (-not $ok) { throw "6 次尝试后仍未能回滚" }

$left2 = Stop-Edge
$leaves = Count-Leaves $target
Say "[2/2] 完成后 msedge 进程 = $left2"
Say "      md5 = $((Get-FileHash $target -Algorithm MD5).Hash)"
Say "      书签数 = $leaves （原始版本应为 778）"
Say ""
Say $(if ($leaves -eq 778) { "结果：已恢复为整理前的 778 条" } else { "结果：条数不是 778，请人工检查" })
Say "=============================================="
