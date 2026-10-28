[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ConfigPath = '',
    [string]$TaskName = 'AyPiBackend'
)

$ErrorActionPreference = 'Stop'
if (-not $ConfigPath) {
    $machineOverride = [Environment]::GetEnvironmentVariable('AYPI_BACKEND_CONFIG', 'Machine')
    if ($machineOverride) {
        $ConfigPath = $machineOverride
    } else {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $actions = @($task.Actions | Where-Object { [IO.Path]::GetFileName(([string]$_.Execute).Trim('"')) -eq 'AyPi Backend.exe' })
        if ($actions.Count -ne 1) {
            throw 'Impossibile individuare il backend. Passare -ConfigPath con il percorso del JSON attivo.'
        }
        $action = $actions[0]
        $exeDirectory = Split-Path -Parent (([string]$action.Execute).Trim('"'))
        $candidates = @()
        if ($action.WorkingDirectory) { $candidates += Join-Path $action.WorkingDirectory 'aypi-backend.runtime.json' }
        $candidates += Join-Path $exeDirectory 'aypi-backend.runtime.json'
        $ConfigPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
}
if (-not $ConfigPath -or -not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw 'Configurazione esistente non trovata. Passare -ConfigPath; nessun file e stato creato o modificato.'
}
$resolvedPath = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
$original = [IO.File]::ReadAllText($resolvedPath)
$config = $original | ConvertFrom-Json
if ($config -isnot [PSCustomObject]) { throw 'Il JSON deve contenere un oggetto di configurazione.' }
if (-not $config.PSObject.Properties['forno'] -or $null -eq $config.forno) {
    $config | Add-Member -NotePropertyName forno -NotePropertyValue ([PSCustomObject]@{}) -Force
}
if ($config.forno -isnot [PSCustomObject]) { throw 'La sezione forno esistente non e un oggetto: modifica interrotta.' }
$values = [ordered]@{
    enabled = $true
    autoStart = $true
    dbPath = '\\Dl360\pubbliche\TECH\AyPi\AGPRESS\General\data\forno.db'
    host = '192.168.1.165'
    intervalMs = 500
}
foreach ($key in $values.Keys) {
    $config.forno | Add-Member -NotePropertyName $key -NotePropertyValue $values[$key] -Force
}
$updated = $config | ConvertTo-Json -Depth 100
$null = $updated | ConvertFrom-Json
if ($PSCmdlet.ShouldProcess($resolvedPath, 'Aggiornare solo la sezione forno e salvare un backup del JSON originale')) {
    $suffix = [Guid]::NewGuid().ToString('N')
    $temporary = $resolvedPath + '.' + $suffix + '.tmp'
    $backup = $resolvedPath + '.forno-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $suffix + '.bak'
    try {
        [IO.File]::WriteAllText($temporary, $updated + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
        if ([IO.File]::ReadAllText($resolvedPath) -ne $original) { throw 'Il JSON e cambiato durante la modifica: operazione interrotta.' }
        [IO.File]::Replace($temporary, $resolvedPath, $backup)
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
    Write-Host "Configurazione aggiornata: $resolvedPath"
    Write-Host "Backup originale: $backup"
    Write-Host 'Riavviare il backend aggiornato per applicare la configurazione.'
}
