// Solo pacchetto backend aziendale: mai eseguire per una release pubblica.
const fs = require('node:fs'), path = require('node:path'), {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const credentialFile = path.join(root, '.private', 'sql-analytics.credentials.json');
if (!fs.existsSync(credentialFile)) throw new Error('Manca la configurazione privata del login SQL dedicato.');
const ps = `Add-Type -AssemblyName System.Security
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$b = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($p.passwordProtected),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
$key = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($key)
try {
 $secure = ConvertTo-SecureString ([Text.Encoding]::UTF8.GetString($b)) -AsPlainText -Force
 @{version=1;installHost='DL360';server=$p.server;instance=$p.instance;database=$p.database;user=$p.user;key=[Convert]::ToBase64String($key);passwordEncrypted=(ConvertFrom-SecureString $secure -Key $key)} | ConvertTo-Json -Compress
} finally { [Array]::Clear($b,0,$b.Length); [Array]::Clear($key,0,$key.Length); $rng.Dispose() }`;
const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',ps], {input:fs.readFileSync(credentialFile,'utf8').replace(/^\uFEFF/,''),encoding:'utf8',windowsHide:true});
if(result.status !== 0) throw new Error('Preparazione privata SQL non riuscita.');
const payload = JSON.parse(result.stdout.trim());
if(payload.user !== 'AyPiAnalytics' || !payload.passwordEncrypted || !payload.key) throw new Error('Configurazione del login SQL dedicato non valida.');
fs.writeFileSync(path.join(root,'.private','backend-provisioning.json'),JSON.stringify(payload));
console.log('Configurazione privata preparata solo per installer backend DL360.');
