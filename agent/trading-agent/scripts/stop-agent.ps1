# Stops the background agent started by the "WTT Paper Agent" task (the task stays registered for next logon).
# Add -Uninstall to also remove the task.
param([switch]$Uninstall)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$name = 'WTT Paper Agent'

# Stop the restart loop first, then the agent itself.
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*run-agent.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*src/index.js*' -and $_.CommandLine -like '*use-system-ca*' } |
    ForEach-Object { Write-Host "Stopping agent pid $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$name'."
}
Write-Host 'Agent stopped.'
