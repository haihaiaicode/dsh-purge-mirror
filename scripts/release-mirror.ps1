<#
.SYNOPSIS
    为本镜像仓库发布新版本（打包 → 校验 → 建 release → 上传）

.DESCRIPTION
    读取 package.json 的版本号，用 npm pack 打出 tgz，生成 SHA256SUMS.txt，
    在 GitHub 上创建对应 tag 的 release 并上传两个附件。

    仓库地址从 package.json 的 repository.url 读取，GitHub 凭据从 git credential 读取，
    不需要额外配置 token。

.PARAMETER Version
    指定版本号（如 1.6.42）。省略时使用 package.json 里的 version。

.PARAMETER DryRun
    只打包并打印将要执行的动作，不创建 release、不上传。

.PARAMETER SkipPack
    跳过 npm pack（已有 tgz 时使用）。

.EXAMPLE
    pwsh scripts/release-mirror.ps1 -DryRun
    pwsh scripts/release-mirror.ps1
    pwsh scripts/release-mirror.ps1 -Version 1.6.42
#>
[CmdletBinding()]
param(
    [string]$Version,
    [switch]$DryRun,
    [switch]$SkipPack
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $root
try {
    # ---------- 1. 版本与包名 ----------
    $pkg = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $name = $pkg.name
    if (-not $Version) { $Version = $pkg.version }
    $tag = "v$Version"
    $tgzName = "$name-$Version.tgz"
    Write-Host "[1/6] 包: $name  版本: $Version  tag: $tag" -ForegroundColor Cyan

    # ---------- 2. 仓库地址 ----------
    $repoUrl = $pkg.repository.url -replace '^git\+', '' -replace '\.git$', ''
    if ($repoUrl -notmatch 'github\.com/([^/]+)/([^/]+)$') {
        throw "无法从 package.json 的 repository.url 解析 GitHub 仓库: $repoUrl"
    }
    $owner = $Matches[1]; $repoName = $Matches[2]
    $slug = "$owner/$repoName"
    Write-Host "[2/6] 目标仓库: $slug" -ForegroundColor Cyan

    # ---------- 3. 工作区检查 ----------
    $dirty = git status --porcelain
    if ($dirty -and -not $DryRun) {
        Write-Host "[!] 工作区有未提交改动：" -ForegroundColor Yellow
        $dirty | ForEach-Object { Write-Host "    $_" }
        throw "请先提交或暂存后再发版"
    }
    Write-Host "[3/6] 工作区检查完成" -ForegroundColor Cyan

    # ---------- 4. 打包 ----------
    if (-not $SkipPack) {
        Get-ChildItem -Filter "*.tgz" -ErrorAction SilentlyContinue | Remove-Item -Force
        Write-Host "[4/6] 打包中..." -ForegroundColor Cyan
        $packOut = npm pack --ignore-scripts 2>&1
        if ($LASTEXITCODE -ne 0) { $packOut | ForEach-Object { Write-Host "    $_" }; throw "npm pack 失败" }
    } else {
        Write-Host "[4/6] 跳过打包" -ForegroundColor Cyan
    }

    $tgz = Join-Path $root $tgzName
    if (-not (Test-Path $tgz)) {
        $found = Get-ChildItem -Filter "*.tgz" | Select-Object -First 1
        if ($found) { $tgz = $found.FullName; $tgzName = $found.Name } else { throw "找不到生成的 tgz" }
    }
    $size = [math]::Round((Get-Item $tgz).Length / 1KB, 1)
    Write-Host "    $tgzName  ($size KB)" -ForegroundColor Gray

    # ---------- 5. 校验清单 ----------
    $hash = (Get-FileHash $tgz -Algorithm SHA256).Hash.ToLower()
    $sumsPath = Join-Path $root "SHA256SUMS.txt"
    "$hash  $tgzName" | Set-Content $sumsPath -Encoding ASCII
    Write-Host "[5/6] SHA256: $hash" -ForegroundColor Cyan

    if ($DryRun) {
        Write-Host "`n[DryRun] 将执行：" -ForegroundColor Yellow
        Write-Host "  - 创建/复用 release $tag ($slug)"
        Write-Host "  - 上传 $tgzName"
        Write-Host "  - 上传 SHA256SUMS.txt"
        Write-Host "`n[DryRun] 结束，未做任何远程改动" -ForegroundColor Yellow
        return
    }

    # ---------- 6. 创建 release 并上传 ----------
    $cred = "protocol=https`nhost=github.com`n`n" | git credential fill 2>&1
    $tokenLine = $cred | Where-Object { $_ -match "^password=" } | Select-Object -First 1
    $token = "$tokenLine".Replace("password=", "").Trim()
    if (-not $token) { throw "无法从 git credential 读取 GitHub token（先 git push 一次让凭据保存）" }

    $headers = @{
        Authorization          = "Bearer $token"
        "User-Agent"           = "$name-release"
        Accept                 = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
    }

    $rel = $null
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$slug/releases/tags/$tag" -Headers $headers -Method Get
        Write-Host "[6/6] release 已存在，更新附件: $($rel.html_url)" -ForegroundColor Cyan
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
        $body = @{
            tag_name         = $tag
            target_commitish = "main"
            name             = $tag
            body             = "镜像发布：$name $Version`n`n- 安装包：$tgzName`n- 校验：SHA256SUMS.txt`n- 许可证：MIT（原作者署名保留于 LICENSE / NOTICE.md）"
            draft            = $false
            prerelease       = $false
        } | ConvertTo-Json
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$slug/releases" -Headers $headers -Method Post -Body $body -ContentType "application/json"
        Write-Host "[6/6] release 已创建: $($rel.html_url)" -ForegroundColor Cyan
    }

    # 删除同名旧附件
    $assets = Invoke-RestMethod -Uri "https://api.github.com/repos/$slug/releases/$($rel.id)/assets" -Headers $headers -Method Get
    foreach ($a in $assets) {
        if ($a.name -in @($tgzName, "SHA256SUMS.txt")) {
            Invoke-RestMethod -Uri "https://api.github.com/repos/$slug/releases/assets/$($a.id)" -Headers $headers -Method Delete | Out-Null
            Write-Host "    删除旧附件: $($a.name)" -ForegroundColor Gray
        }
    }

    $uploadBase = "https://uploads.github.com/repos/$slug/releases/$($rel.id)/assets"
    foreach ($f in @($tgz, $sumsPath)) {
        $fn = Split-Path $f -Leaf
        $bytes = [System.IO.File]::ReadAllBytes($f)
        $r = Invoke-RestMethod -Uri "${uploadBase}?name=$fn" -Headers $headers -Method Post -Body $bytes -ContentType "application/octet-stream"
        Write-Host "    已上传: $($r.name)  $([math]::Round($r.size/1KB,1)) KB" -ForegroundColor Green
    }

    Write-Host "`n完成：https://github.com/$slug/releases/tag/$tag" -ForegroundColor Green
    Write-Host "别忘了：git push 让 tag 与提交上去（如果 release 是新建的，tag 已在云端）" -ForegroundColor Yellow
}
finally {
    Pop-Location
}
