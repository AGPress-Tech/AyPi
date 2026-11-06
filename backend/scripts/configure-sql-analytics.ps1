param(
    [string]$Server = 'DL360',
    [string]$Instance = 'SQL2017',
    [string]$Database = 'NuovaAGP',
    [PSCredential]$Credential,
    [string]$Destination = (Join-Path $env:ProgramData 'AGPress\AyPiBackend\sql-analytics.credentials.json')
)
$ErrorActionPreference = 'Stop'
if (-not $Credential) { $Credential = Get-Credential -UserName 'sa' -Message 'Accesso SQL del backend AyPi' }
if (-not $Credential) { throw 'Credenziali mancanti.' }
Add-Type -AssemblyName System.Security
$targetPath = [IO.Path]::GetFullPath($Destination)
$targetDirectory = Split-Path -Parent $targetPath
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$adminsSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$bytes = [Text.Encoding]::UTF8.GetBytes($Credential.GetNetworkCredential().Password)
try {
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    $payload = @{version=1;server=$Server;instance=$Instance;database=$Database;user=$Credential.UserName;passwordProtected=[Convert]::ToBase64String($protected);encrypt=$true;trustServerCertificate=$true}
    $payload | ConvertTo-Json | Set-Content -LiteralPath $targetPath -Encoding UTF8
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @($identity,$systemSid,$adminsSid)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $targetPath -AclObject $acl
    Write-Output 'Configurazione SQL cifrata salvata per il backend su questo computer.'
} finally { [Array]::Clear($bytes,0,$bytes.Length) }
