param(
    [string]$Version = "v0.1.0"
)

$ErrorActionPreference = "Stop"
$installPath = "C:\Temp\SCW"
$repositoryUrl = "https://github.com/pavelvraj/scw.git"
$firstInitialization = $false

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & git -C $installPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git selhal: git -C `"$installPath`" $($Arguments -join ' ')"
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git není nainstalovaný nebo není v PATH. Nainstaluj Git for Windows a spusť skript znovu."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker není nainstalovaný nebo není v PATH. Spusť Docker Desktop a zkus to znovu."
}

New-Item -ItemType Directory -Force -Path $installPath | Out-Null

$gitDirectory = Join-Path $installPath ".git"
if (-not (Test-Path -LiteralPath $gitDirectory)) {
    $firstInitialization = $true
    $allowedExistingItems = @("data", ".env", ".env.example", "UPDATE.ps1")
    $unexpectedItems = @(
        Get-ChildItem -Force -LiteralPath $installPath |
            Where-Object { $_.Name -notin $allowedExistingItems }
    )

    if ($unexpectedItems.Count -gt 0) {
        $names = $unexpectedItems.Name -join ", "
        throw "Cílová složka $installPath obsahuje jiné soubory než data/.env. Nejdříve je zazálohuj nebo odstraň: $names"
    }

    Write-Host "Inicializuji Git repozitář přímo v $installPath..." -ForegroundColor Cyan
    Invoke-Git -Arguments @("init")
    Invoke-Git -Arguments @("remote", "add", "origin", $repositoryUrl)
} else {
    $currentRemote = (& git -C $installPath remote get-url origin 2>$null)
    if ($LASTEXITCODE -ne 0) {
        Invoke-Git -Arguments @("remote", "add", "origin", $repositoryUrl)
    } elseif ($currentRemote.Trim() -ne $repositoryUrl) {
        Invoke-Git -Arguments @("remote", "set-url", "origin", $repositoryUrl)
    }
}

Write-Host "Stahuji tag $Version z GitHubu..." -ForegroundColor Cyan
Invoke-Git -Arguments @("fetch", "--tags", "origin")
Invoke-Git -Arguments @("rev-parse", "--verify", "$Version^{commit}")

$temporaryBackups = @()
if ($firstInitialization) {
    foreach ($fileName in @("UPDATE.ps1", ".env.example")) {
        $sourcePath = Join-Path $installPath $fileName
        if (Test-Path -LiteralPath $sourcePath) {
            $backupPath = Join-Path ([System.IO.Path]::GetTempPath()) ("SCW-" + [guid]::NewGuid().ToString("N") + "-" + $fileName)
            Move-Item -LiteralPath $sourcePath -Destination $backupPath
            $temporaryBackups += $backupPath
        }
    }
}

try {
    Invoke-Git -Arguments @("checkout", "--detach", $Version)
} catch {
    foreach ($backupPath in $temporaryBackups) {
        $backupName = Split-Path -Leaf $backupPath
        if ($backupName -like "*-UPDATE.ps1") {
            Move-Item -LiteralPath $backupPath -Destination (Join-Path $installPath "UPDATE.ps1")
        } elseif ($backupName -like "*-.env.example") {
            Move-Item -LiteralPath $backupPath -Destination (Join-Path $installPath ".env.example")
        }
    }
    throw
}

foreach ($backupPath in $temporaryBackups) {
    if (Test-Path -LiteralPath $backupPath) {
        Remove-Item -LiteralPath $backupPath -Force
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $installPath ".env"))) {
    Copy-Item -LiteralPath (Join-Path $installPath ".env.example") -Destination (Join-Path $installPath ".env")
    Write-Host "Vytvořen .env. Nastav v něm svou doménu před prvním spuštěním Dockeru." -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path (Join-Path $installPath "data") | Out-Null
Set-Location -LiteralPath $installPath

Write-Host "Spouštím Docker Compose z $installPath..." -ForegroundColor Cyan
& docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose selhal. Zkontroluj logy příkazem: docker compose logs --tail=100"
}

Write-Host "Hotovo. Nasazená verze: $Version" -ForegroundColor Green
Write-Host "Adresář dat zůstal zachován: $(Join-Path $installPath 'data')"
Write-Host "Případné logy: docker compose -f `"$(Join-Path $installPath 'docker-compose.yml')`" logs -f"
