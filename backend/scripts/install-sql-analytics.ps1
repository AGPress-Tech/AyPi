param(
    [string]$ProvisioningFile = (Join-Path $PSScriptRoot '..\backend-provisioning.json'),
    [string]$Destination = (Join-Path $env:ProgramData 'AGPress\AyPiBackend\sql-analytics.credentials.json')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ProvisioningFile)) {
    if (Test-Path -LiteralPath $Destination) { exit 0 }
    throw 'Configurazione SQL mancante nel pacchetto backend.'
}
$settings = Get-Content -Raw -LiteralPath $ProvisioningFile | ConvertFrom-Json
if ($env:COMPUTERNAME -ine $settings.installHost) { throw "Questo installer backend e destinato a $($settings.installHost)." }
$key = [Convert]::FromBase64String($settings.key)
try {
    $password = ConvertTo-SecureString -String $settings.passwordEncrypted -Key $key
    $credential = New-Object System.Management.Automation.PSCredential($settings.user, $password)
    & (Join-Path $PSScriptRoot 'configure-sql-analytics.ps1') -Server $settings.server -Instance $settings.instance -Database $settings.database -Credential $credential -Destination $Destination
    # Verifica il collegamento prima di avviare il backend.
    $connection = New-Object System.Data.SqlClient.SqlConnection
    $connection.ConnectionString = "Data Source=$($settings.server)\$($settings.instance);Initial Catalog=$($settings.database);Encrypt=True;TrustServerCertificate=True;Connect Timeout=15"
    $password.MakeReadOnly()
    $connection.Credential = New-Object System.Data.SqlClient.SqlCredential($settings.user, $password)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = 'SELECT TOP (0) m.Account,c.Description FROM dbo.MA_JournalEntriesGLDetail m LEFT JOIN dbo.MA_ChartOfAccounts c ON m.Account=c.Account'
        $command.ExecuteNonQuery() | Out-Null
    } finally { $connection.Dispose() }
    Remove-Item -LiteralPath $ProvisioningFile -Force
    Write-Output 'SQL configurato e collegamento verificato.'
} finally { [Array]::Clear($key,0,$key.Length) }
