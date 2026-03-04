$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
  throw "Run this script in an elevated PowerShell (Run as Administrator)."
}

Write-Output "Enabling Microsoft-Windows-Subsystem-Linux..."
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart

Write-Output "Enabling VirtualMachinePlatform..."
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

Write-Output "Installing WSL core components..."
wsl --install --no-distribution

Write-Output ""
Write-Output "Done. Reboot Windows now, then start Docker Desktop."
Write-Output "After Docker is healthy, run:"
Write-Output "  powershell -ExecutionPolicy Bypass -File .\\scripts\\setup-local-osrm.ps1"
