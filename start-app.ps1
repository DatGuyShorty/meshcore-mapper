param(
  [string]$Python = "python",
  [string]$VenvDir = ".venv",
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$nodeModules = Join-Path $repoRoot 'node_modules'
$requirements = Join-Path $repoRoot 'requirements-cuda.txt'
$venvPath = Join-Path $repoRoot $VenvDir
$venvPython = Join-Path $venvPath 'Scripts\python.exe'
$requirementsStamp = Join-Path $venvPath '.requirements-cuda.stamp'

function Resolve-CommandPath {
  param([Parameter(Mandatory = $true)][string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command not found: $Name"
  }
  return $command.Source
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$Description
  )

  Write-Host $Description
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath exited with code $LASTEXITCODE"
  }
}

Set-Location $repoRoot

$npm = Resolve-CommandPath 'npm'
$pythonExe = Resolve-CommandPath $Python

if (-not (Test-Path $nodeModules)) {
  Invoke-External -FilePath $npm -Arguments @('install') -Description 'Installing npm dependencies...'
} else {
  Write-Host 'npm dependencies already present.'
}

if (-not (Test-Path $venvPython)) {
  Invoke-External -FilePath $pythonExe -Arguments @('-m', 'venv', $venvPath) -Description "Creating Python virtual environment at $VenvDir..."
}

Invoke-External -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '--upgrade', 'pip') -Description 'Upgrading pip in the project virtual environment...'

$installPythonDeps = $false
if (Test-Path $requirements) {
  $installPythonDeps = -not (Test-Path $requirementsStamp)
  if (-not $installPythonDeps) {
    $installPythonDeps = (Get-Item $requirements).LastWriteTimeUtc -gt (Get-Item $requirementsStamp).LastWriteTimeUtc
  }
}

if ($installPythonDeps) {
  Invoke-External -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '-r', $requirements) -Description 'Installing Python dependencies from requirements-cuda.txt...'
  Set-Content -Path $requirementsStamp -Value (Get-Date).ToString('o') -NoNewline
} elseif (Test-Path $requirements) {
  Write-Host 'Python dependencies already installed for the current requirements file.'
}

$env:MESHCORE_PYTHON = $venvPython

if ($NoLaunch) {
  Write-Host 'Setup complete. Launch skipped.'
  return
}

Invoke-External -FilePath $npm -Arguments @('start') -Description 'Starting MeshCore Mapper...'
