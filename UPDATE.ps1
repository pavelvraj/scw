param(
    [string]$Version = "v0.1.1"
)

$ErrorActionPreference = "Stop"
$installPath = "C:\Temp\SCW"
$repositoryUrl = "https://github.com/pavelvraj/scw.git"
$preservedNames = @(".git", ".env", "data", "certs", "docker-compose.override.yml", "docker-compose.override.yaml")

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & git -C $installPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git failed: git -C `"$installPath`" $($Arguments -join ' ')"
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is not installed or is not available in PATH."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed or is not available in PATH."
}

New-Item -ItemType Directory -Force -Path $installPath | Out-Null

$gitDirectory = Join-Path $installPath ".git"
if (-not (Test-Path -LiteralPath $gitDirectory)) {
    Write-Host "Initializing Git repository in $installPath..." -ForegroundColor Cyan
    & git -C $installPath init
    if ($LASTEXITCODE -ne 0) {
        throw "Git init failed."
    }
}

$currentRemote = (& git -C $installPath remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0) {
    Invoke-Git -Arguments @("remote", "add", "origin", $repositoryUrl)
} elseif ($currentRemote.Trim() -ne $repositoryUrl) {
    Invoke-Git -Arguments @("remote", "set-url", "origin", $repositoryUrl)
}

Write-Host "Downloading $Version from GitHub..." -ForegroundColor Cyan
Invoke-Git -Arguments @("fetch", "--tags", "--force", "origin")

$versionCommit = (& git -C $installPath rev-parse --verify "$Version^{commit}" 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($versionCommit)) {
    $availableTags = @(& git -C $installPath tag --list "v*" --sort=-version:refname | Select-Object -First 10)
    $tagText = if ($availableTags.Count -gt 0) { $availableTags -join ", " } else { "none" }
    throw "Version $Version does not exist on GitHub. Available tags: $tagText"
}

if (Test-Path -LiteralPath (Join-Path $installPath "docker-compose.yml")) {
    Write-Host "Stopping existing Docker services..." -ForegroundColor Cyan
    & docker compose -f (Join-Path $installPath "docker-compose.yml") down
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose could not stop the existing services."
    }
}

$backupPath = Join-Path (Split-Path $installPath -Parent) ("SCW-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$itemsToReplace = @(
    Get-ChildItem -Force -LiteralPath $installPath |
        Where-Object { $_.Name -notin $preservedNames }
)

if ($itemsToReplace.Count -gt 0) {
    New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
    foreach ($item in $itemsToReplace) {
        Move-Item -LiteralPath $item.FullName -Destination $backupPath
    }
    Write-Host "Old source files were moved to $backupPath" -ForegroundColor Yellow
}

Write-Host "Checking out $Version..." -ForegroundColor Cyan
Invoke-Git -Arguments @("checkout", "--detach", $Version)

$environmentFile = Join-Path $installPath ".env"
if (-not (Test-Path -LiteralPath $environmentFile)) {
    Copy-Item -LiteralPath (Join-Path $installPath ".env.example") -Destination $environmentFile
    Write-Host "Created .env from .env.example. Check DOMAIN before using the public URL." -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path (Join-Path $installPath "data") | Out-Null
Set-Location -LiteralPath $installPath

Write-Host "Building and starting Docker Compose..." -ForegroundColor Cyan
& docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose failed. Check: docker compose logs --tail=100"
}

Write-Host "Update complete: $Version" -ForegroundColor Green
Write-Host "Data preserved in: $(Join-Path $installPath 'data')"
if ($itemsToReplace.Count -gt 0) {
    Write-Host "Backup preserved in: $backupPath"
}
