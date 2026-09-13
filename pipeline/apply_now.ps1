# Install cleaned bookmarks into Edge, surviving Edge's "startup boost" auto-relaunch.
# ASCII-only output on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI,
# which corrupts non-ASCII text and can break parsing.
$ErrorActionPreference = 'Stop'

$W          = "C:\Users\yangzhiheng\WorkBuddy\2026-09-13-22-18-54\bookmarks_work"
$profileDir = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\Default"
$target     = Join-Path $profileDir "Bookmarks"
$src        = Join-Path $W "Bookmarks.cleaned.json"
$backupDir  = Join-Path $W "backup"
$stamp      = Get-Date -Format "yyyyMMdd-HHmmss"

function Say($m) { Write-Host $m }

function Stop-Edge {
    for ($i = 0; $i -lt 12; $i++) {
        $p = Get-Process -Name msedge -ErrorAction SilentlyContinue
        if (-not $p) { return 0 }
        foreach ($pr in $p) {
            try { Stop-Process -Id $pr.Id -Force -ErrorAction Stop } catch {}
        }
        Start-Sleep -Milliseconds 350
    }
    return (Get-Process -Name msedge -ErrorAction SilentlyContinue | Measure-Object).Count
}

function Count-Leaves($path) {
    $txt = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    $obj = $txt | ConvertFrom-Json
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
Say " Edge bookmarks - install (auto-relaunch safe)"
Say "=============================================="

if (-not (Test-Path $target)) { throw "target not found: $target" }
if (-not (Test-Path $src))    { throw "source not found: $src" }

# --- 1. back up the live file BEFORE anything else ---
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$histBak = Join-Path $backupDir "Bookmarks.$stamp.json"
Copy-Item $target $histBak -Force
Copy-Item $target "$target.manualbak" -Force
Say "[1/5] backup of LIVE file -> $histBak"
Say "      also kept at        -> $target.manualbak"

$srcHash = (Get-FileHash $src -Algorithm MD5).Hash
$liveHashBefore = (Get-FileHash $target -Algorithm MD5).Hash
Say "      live md5 before = $liveHashBefore"
Say "      src  md5        = $srcHash"

# --- 2. kill Edge, then swap atomically, retrying if Edge comes back ---
$ok = $false
for ($attempt = 1; $attempt -le 6; $attempt++) {
    $left = Stop-Edge
    if ($left -ne 0) { Say "[2/5] attempt $attempt - $left msedge process(es) still alive, retrying" ; continue }

    $tmp = Join-Path $profileDir "Bookmarks.wbnew"
    Copy-Item $src $tmp -Force
    try {
        [System.IO.File]::Replace($tmp, $target, $null)
    } catch {
        try { Move-Item $tmp $target -Force } catch { Say "      swap failed: $($_.Exception.Message)" }
    }
    if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }

    $nowHash = (Get-FileHash $target -Algorithm MD5).Hash
    if ($nowHash -eq $srcHash) {
        Say "[2/5] attempt $attempt - swap OK (md5 matches cleaned file)"
        $ok = $true
        break
    }
    Say "[2/5] attempt $attempt - hash mismatch ($nowHash), Edge may have rewritten it; retrying"
    Start-Sleep -Milliseconds 800
}
if (-not $ok) { throw "could not install after 6 attempts" }

# --- 3. kill again so no live instance holds the OLD tree in memory ---
$left2 = Stop-Edge
Say "[3/5] post-swap kill: remaining msedge = $left2"
Start-Sleep -Seconds 2

# --- 4. verify on-disk content is really the cleaned set ---
$finalHash = (Get-FileHash $target -Algorithm MD5).Hash
$leaves    = Count-Leaves $target
$size      = (Get-Item $target).Length
Say "[4/5] on-disk md5 = $finalHash  (expect $srcHash)"
Say "      size = $size bytes, bookmark leaves = $leaves (expect 386)"

# --- 5. report ---
$edgeNow = (Get-Process -Name msedge -ErrorAction SilentlyContinue | Measure-Object).Count
Say "[5/5] msedge processes now = $edgeNow"
if ($finalHash -eq $srcHash -and $leaves -eq 386) {
    Say ""
    Say "RESULT: SUCCESS"
} else {
    Say ""
    Say "RESULT: CHECK FAILED - do not trust, roll back with rollback.ps1"
}
Say "rollback: $target.manualbak  or  $histBak"
Say "=============================================="
