param(
  [string]$DataDir = "C:\Users\dell\Documents\revathy\osrm-data",
  [string]$MapFile = "southern-zone-latest.osm.pbf",
  [string]$MapDownloadUrl = "",
  [int]$ExtractThreads = 2,
  [int]$Port = 5001
)

$ErrorActionPreference = "Stop"

$dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if (-not (Test-Path $dockerExe)) {
  throw "Docker CLI not found at '$dockerExe'. Install Docker Desktop first."
}

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args,
    [switch]$IgnoreFailure
  )

  & $dockerExe @Args
  if (-not $IgnoreFailure -and $LASTEXITCODE -ne 0) {
    throw "Docker command failed: docker $($Args -join ' ')"
  }
}

Invoke-Docker -Args @("info") | Out-Null

if (-not (Test-Path $DataDir)) {
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

$mapPath = Join-Path $DataDir $MapFile
if (-not (Test-Path $mapPath)) {
  if ([string]::IsNullOrWhiteSpace($MapDownloadUrl)) {
    $MapDownloadUrl = "https://download.geofabrik.de/asia/india/$MapFile"
  }
  Write-Output "Downloading map extract: $MapDownloadUrl"
  Invoke-WebRequest -Uri $MapDownloadUrl -OutFile $mapPath
}

$resolvedDataDir = (Resolve-Path $DataDir).Path
$datasetName = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFileNameWithoutExtension($MapFile))
$osrmBase = "/data/$datasetName.osrm"

Write-Output "Using map file: $mapPath"
Write-Output "Docker data mount: $($resolvedDataDir):/data"
Write-Output "OSRM extract threads: $ExtractThreads"

Write-Output "Pulling OSRM backend image..."
Invoke-Docker -Args @("pull", "osrm/osrm-backend:latest")

Write-Output "Running osrm-extract..."
Invoke-Docker -Args @(
  "run", "--rm", "-t",
  "-v", "${resolvedDataDir}:/data",
  "osrm/osrm-backend:latest",
  "osrm-extract", "-p", "/opt/car.lua", "--threads", "$ExtractThreads", "/data/$MapFile"
)

Write-Output "Running osrm-partition..."
Invoke-Docker -Args @(
  "run", "--rm", "-t",
  "-v", "${resolvedDataDir}:/data",
  "osrm/osrm-backend:latest",
  "osrm-partition", $osrmBase
)

Write-Output "Running osrm-customize..."
Invoke-Docker -Args @(
  "run", "--rm", "-t",
  "-v", "${resolvedDataDir}:/data",
  "osrm/osrm-backend:latest",
  "osrm-customize", $osrmBase
)

Write-Output "Replacing previous local OSRM container (if any)..."
$existing = & $dockerExe ps -a --filter "name=^osrm-local$" --format "{{.Names}}"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to check existing Docker containers."
}
if ($existing -contains "osrm-local") {
  Invoke-Docker -Args @("rm", "-f", "osrm-local")
}

Write-Output "Starting osrm-routed on port $Port..."
Invoke-Docker -Args @(
  "run", "-d", "--name", "osrm-local",
  "-p", "${Port}:5000",
  "-v", "${resolvedDataDir}:/data",
  "osrm/osrm-backend:latest",
  "osrm-routed", "--algorithm", "mld", $osrmBase
)

Write-Output "OSRM is starting. Test endpoint:"
Write-Output "http://localhost:$Port/route/v1/driving/80.2707,13.0827;80.2900,13.0600?overview=false"
