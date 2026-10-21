# Runs the WTT agent continuously (used by the "WTT Paper Agent" scheduled task, hidden window).
# Restarts the agent 60 s after it exits. Create data\NO_RESTART to stop the restart loop.
# Agent log: data\agent.log (redacted). Console output (startup errors): data\console.log.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$node = (Get-Command node -ErrorAction Stop).Source
$console = Join-Path $root 'data\console.log'
New-Item -ItemType Directory -Force -Path (Join-Path $root 'data') | Out-Null

while ($true) {
    Add-Content -Path $console -Value "$(Get-Date -Format o) starting agent"
    & $node --use-system-ca src/index.js *>> $console
    Add-Content -Path $console -Value "$(Get-Date -Format o) agent exited with code $LASTEXITCODE"
    if (Test-Path (Join-Path $root 'data\NO_RESTART')) { break }
    Start-Sleep -Seconds 60
}
