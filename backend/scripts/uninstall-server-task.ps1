param(
    [string]$TaskName = "AyPiBackend"
)

$ErrorActionPreference = "Stop"
Get-NetFirewallRule -Name 'AyPiBackend-LAN' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Task '$TaskName' non trovato."
    exit 0
}

try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
} catch {
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Task '$TaskName' rimosso."
