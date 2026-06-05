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

$quotedExe = '"' + $ExePath + '"'
$taskCommand = "/c set AYPI_BACKEND_HEADLESS=1&& $quotedExe"
$taskAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $taskCommand
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
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

$task = New-ScheduledTask `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Principal $taskPrincipal `
    -Settings $taskSettings

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Task '$TaskName' installato e avviato."
Write-Host "Comando: cmd.exe $taskCommand"
