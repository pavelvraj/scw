param(
    [string]$Distro = "Ubuntu-24.04",
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell window (Run as Administrator)."
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw "wsl.exe is not available. Install or enable WSL2 first."
}

$wslOutput = (& wsl.exe --distribution $Distro --user root -- hostname -I 2>$null | Out-String)
$ipMatch = [regex]::Match($wslOutput, '\b(?:\d{1,3}\.){3}\d{1,3}\b')
if (-not $ipMatch.Success) {
    throw "Could not determine the IPv4 address of WSL distribution '$Distro'."
}

$wslIp = $ipMatch.Value
Write-Host "WSL IPv4 address: $wslIp" -ForegroundColor Cyan

& netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port 2>$null | Out-Null
& netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$Port connectaddress=$wslIp connectport=$Port
if ($LASTEXITCODE -ne 0) {
    throw "Could not create the Windows portproxy rule for TCP port $Port."
}

$ruleName = "Stream Cinema WSL TCP $Port"
$firewallRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($null -eq $firewallRule) {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $Port `
        -Action Allow `
        -Profile Domain,Private | Out-Null
} else {
    Enable-NetFirewallRule -DisplayName $ruleName | Out-Null
}

Write-Host "Port $Port is forwarded from Windows to WSL $wslIp`:$Port." -ForegroundColor Green
Write-Host "Router target remains the Windows machine IP on TCP port $Port." -ForegroundColor Green
Write-Host "Run this script again after WSL restarts if its IP changes." -ForegroundColor Yellow
