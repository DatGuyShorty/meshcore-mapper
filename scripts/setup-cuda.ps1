param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $repoRoot "requirements-cuda.txt"

Write-Host "Installing optional CUDA coverage dependencies..."
& $Python -m pip install -r $requirements

Write-Host "CUDA dependencies installed. Restart Meshcore Mapper to refresh backend availability."
