param(
    [string]$TaskName = "AyPiBackend",
    [string]$ExePath = "",
    [string]$RunAsUser = "SYSTEM"
)

$ErrorActionPreference = "Stop"

if (-not $ExePath) {
    throw "Passa -ExePath con il percorso completo di 'AyPi Backend.exe'."
}

if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "Exe non trovato: $ExePath"
}

$resolvedExePath = (Resolve-Path -LiteralPath $ExePath).Path
Get-NetFirewallRule -Name 'AyPiBackend-LAN' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name 'AyPiBackend-LAN' -DisplayName 'AyPi Backend - rete aziendale' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Program $resolvedExePath -RemoteAddress LocalSubnet -Profile Any | Out-Null
$exeDirectory = Split-Path -Parent $resolvedExePath
$taskAction = New-ScheduledTaskAction `
    -Execute $resolvedExePath `
    -Argument "--headless" `
    -WorkingDirectory $exeDirectory
$taskTrigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = if ($RunAsUser -eq "SYSTEM") {
    New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
} else {
    New-ScheduledTaskPrincipal -UserId $RunAsUser -LogonType Password -RunLevel Highest
}
$taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable

$task = New-ScheduledTask `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Principal $taskPrincipal `
    -Settings $taskSettings

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Task '$TaskName' installato e avviato."
Write-Host "Eseguibile: $resolvedExePath --headless"
