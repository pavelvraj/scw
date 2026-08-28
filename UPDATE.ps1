param(
    [string]$Version = "v0.3.2",
    [string]$WslDistro = ""
)

$ErrorActionPreference = "Stop"
$installPath = "C:\Temp\SCW"
$repositoryUrl = "https://github.com/pavelvraj/scw.git"
$preservedNames = @(".git", ".env", "data", "certs", "docker-compose.override.yml", "docker-compose.override.yaml")
$script:dockerMode = "unavailable"
$script:selectedWslDistro = ""
$script:composeFilePath = Join-Path $installPath "docker-compose.yml"
$script:composeProjectPath = $installPath
$script:composeEnvironmentPath = Join-Path $installPath ".env"
$script:wslComposeFilePath = ""
$script:wslComposeProjectPath = ""
$script:wslComposeEnvironmentPath = ""

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

function Convert-ToWslPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WindowsPath
    )

    $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
    $match = [regex]::Match($fullPath, '^(?<drive>[A-Za-z]):\\(?<rest>.*)$')
    if (-not $match.Success) {
        throw "Cannot convert Windows path to WSL path: $fullPath"
    }

    $drive = $match.Groups["drive"].Value.ToLowerInvariant()
    $rest = $match.Groups["rest"].Value -replace '\\', '/'
    return "/mnt/$drive/$rest"
}

function Test-WindowsDockerEngine {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        return $false
    }

    $exitCode = 1
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
        $exitCode = $LASTEXITCODE
    } catch {
        $exitCode = 1
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return ($exitCode -eq 0)
}

function Test-WslDockerEngine {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DistroName
    )

    $exitCode = 1
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & wsl.exe --distribution $DistroName --user root -- docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
        $exitCode = $LASTEXITCODE
    } catch {
        $exitCode = 1
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return ($exitCode -eq 0)
}

function Initialize-DockerRuntime {
    if (Test-WindowsDockerEngine) {
        $script:dockerMode = "windows"
        return
    }

    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        return
    }

    $preferredDistro = $WslDistro
    if ([string]::IsNullOrWhiteSpace($preferredDistro)) {
        $preferredDistro = $env:SCW_WSL_DISTRO
    }

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($preferredDistro)) {
        $candidates += $preferredDistro.Trim()
    }

    $listedDistros = @(
        & wsl.exe --list --quiet 2>$null |
            ForEach-Object {
                $name = ($_ -replace "`0", "").Trim().TrimStart("*").Trim()
                if (-not [string]::IsNullOrWhiteSpace($name)) {
                    $name
                }
            }
    )
    foreach ($name in $listedDistros) {
        if ($candidates -notcontains $name) {
            $candidates += $name
        }
    }

    foreach ($candidate in $candidates) {
        if (Test-WslDockerEngine -DistroName $candidate) {
            $script:dockerMode = "wsl"
            $script:selectedWslDistro = $candidate
            $script:wslComposeFilePath = Convert-ToWslPath $script:composeFilePath
            $script:wslComposeProjectPath = Convert-ToWslPath $script:composeProjectPath
            $script:wslComposeEnvironmentPath = Convert-ToWslPath $script:composeEnvironmentPath
            return
        }
    }
}

function Test-DockerEngine {
    if ($script:dockerMode -eq "windows") {
        return (Test-WindowsDockerEngine)
    }
    if ($script:dockerMode -eq "wsl") {
        return (Test-WslDockerEngine -DistroName $script:selectedWslDistro)
    }
    return $false
}

function Test-DockerCompose {
    if (-not (Test-DockerEngine)) {
        return $false
    }

    $exitCode = 1
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        if ($script:dockerMode -eq "windows") {
            & docker compose version 2>$null | Out-Null
        } else {
            & wsl.exe --distribution $script:selectedWslDistro --user root -- docker compose version 2>$null | Out-Null
        }
        $exitCode = $LASTEXITCODE
    } catch {
        $exitCode = 1
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return ($exitCode -eq 0)
}

function Invoke-Docker {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    if ($script:dockerMode -eq "windows") {
        & docker @Arguments
        return
    }

    if ($script:dockerMode -eq "wsl") {
        & wsl.exe --distribution $script:selectedWslDistro --user root -- docker @Arguments
        return
    }

    throw "No usable Docker runtime has been selected."
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    if ($script:dockerMode -eq "wsl") {
        $composeArguments = @(
            "compose",
            "--project-directory", $script:wslComposeProjectPath
        )
        if (Test-Path -LiteralPath $script:composeEnvironmentPath) {
            $composeArguments += @("--env-file", $script:wslComposeEnvironmentPath)
        }
        $composeArguments += @("-f", $script:wslComposeFilePath)
    } else {
        $composeArguments = @(
            "compose",
            "--project-directory", $script:composeProjectPath
        )
        if (Test-Path -LiteralPath $script:composeEnvironmentPath) {
            $composeArguments += @("--env-file", $script:composeEnvironmentPath)
        }
        $composeArguments += @("-f", $script:composeFilePath)
    }

    $composeArguments += $Arguments
    Invoke-Docker -Arguments $composeArguments
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is not installed or is not available in PATH."
}

# Support the existing PowerShell convention: $Distro can be defined before
# invoking this script. -WslDistro and SCW_WSL_DISTRO take precedence.
if ([string]::IsNullOrWhiteSpace($WslDistro)) {
    $callerDistro = Get-Variable -Name Distro -Scope 1 -ErrorAction SilentlyContinue
    if ($null -ne $callerDistro -and -not [string]::IsNullOrWhiteSpace([string]$callerDistro.Value)) {
        $WslDistro = [string]$callerDistro.Value
    }
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

Initialize-DockerRuntime
if ($script:dockerMode -eq "windows") {
    Write-Host "Using Windows Docker engine." -ForegroundColor Cyan
} elseif ($script:dockerMode -eq "wsl") {
    Write-Host "Using Docker engine from WSL distribution: $script:selectedWslDistro" -ForegroundColor Cyan
} else {
    Write-Warning "No running Docker engine was detected. The files will be updated, but Docker services will not be restarted."
}

if ((Test-DockerEngine) -and -not (Test-DockerCompose)) {
    throw "Docker Engine is running, but the Docker Compose plugin is unavailable."
}

if ((Test-DockerEngine) -and (Test-Path -LiteralPath $script:composeFilePath)) {
    Write-Host "Stopping existing Docker services..." -ForegroundColor Cyan
    Invoke-Compose -Arguments @("down")
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
Invoke-Git -Arguments @("checkout", "--force", "--detach", $Version)

$requiredFiles = @(
    ".dockerignore",
    ".env.example",
    ".gitignore",
    "Caddyfile",
    "Dockerfile",
    "Dockerfile.caddy",
    "docker-compose.yml",
    "requirements.txt",
    "app"
)
$missingFiles = @(
    $requiredFiles |
        Where-Object { -not (Test-Path -LiteralPath (Join-Path $installPath $_)) }
)
if ($missingFiles.Count -gt 0) {
    throw "Checkout did not restore required files: $($missingFiles -join ', ')"
}

$environmentFile = Join-Path $installPath ".env"
if (-not (Test-Path -LiteralPath $environmentFile)) {
    Copy-Item -LiteralPath (Join-Path $installPath ".env.example") -Destination $environmentFile
    Write-Host "Created .env from .env.example. Check DOMAIN before using the public URL." -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path (Join-Path $installPath "data") | Out-Null
Set-Location -LiteralPath $installPath

# Docker may have been started while the Git checkout was running. Re-detect
# the runtime before deciding whether to build the services.
if (-not (Test-DockerEngine)) {
    Initialize-DockerRuntime
}

if ((Test-DockerEngine) -and (Test-DockerCompose)) {
    Write-Host "Building and starting Docker Compose..." -ForegroundColor Cyan
    Invoke-Compose -Arguments @("up", "-d", "--build")
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed. Check the service logs."
    }
} else {
    Write-Host "Source update complete. Docker services were not started because no working Docker engine was found." -ForegroundColor Yellow
    if ($script:dockerMode -eq "wsl") {
        Write-Host "Start the WSL Docker service, then run: wsl -d $script:selectedWslDistro -u root -- docker compose --project-directory $script:wslComposeProjectPath --env-file $script:wslComposeEnvironmentPath -f $script:wslComposeFilePath up -d --build" -ForegroundColor Yellow
    } else {
        Write-Host "Start Docker or the WSL Docker service, then run docker compose up -d --build." -ForegroundColor Yellow
    }
}

Write-Host "Update complete: $Version" -ForegroundColor Green
Write-Host "Data preserved in: $(Join-Path $installPath 'data')"
if ($itemsToReplace.Count -gt 0) {
    Write-Host "Backup preserved in: $backupPath"
}
