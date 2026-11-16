param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
function Scalar($v){if($null -eq $v -or $v -is [DBNull]){return $null};if($v -is [DateTime]){return $v.ToString('yyyy-MM-dd')};return $v}
function Rows($db,$table,$columns){$rs=$db.OpenRecordset('SELECT * FROM ['+$table+']',4);try{while(-not $rs.EOF){$r=[ordered]@{};foreach($k in $columns.Keys){$r[$k]=Scalar $rs.Fields.Item($columns[$k]).Value};[pscustomobject]$r;$rs.MoveNext()}}finally{$rs.Close()}}
$engine=New-Object -ComObject DAO.DBEngine.120;$db=$engine.OpenDatabase($Source,$false,$true)
try{
 $suppliers=@(Rows $db 'tblFornitori' @{id='ID';name='Fornitore';criticality='Criticità'})
 $records=@(Rows $db 'tblValutazioni' @{id='ID';date='Data';supplier='Fornitore';punctuality='Puntualità';condition='Stato';conformity='Conformità';notes='Note';ddt='DDT';extra='Campo1'})
 $levels=@(Rows $db 'tblCriticità' @{name='Criticità';rank='Criticità Num'})
 $options=@();foreach($definition in @(@('punctuality','tblPuntualità','Puntualità','Puntualità N'),@('condition','tblStato','Stato','Stato N'),@('conformity','tblConformità','Conformità','Conformità N'))){foreach($row in @(Rows $db $definition[1] @{name=$definition[2];rank=$definition[3]})){$options+=[ordered]@{dimension=$definition[0];name=$row.name;rank=$row.rank}}}
 $config=@(Rows $db 'tblConfigurazione' @{name='Parametro';value='Valore'})
 $attachments=@();$rs=$db.OpenRecordset('SELECT ID,Allegati FROM tblValutazioni',4)
 try{while(-not $rs.EOF){$child=$rs.Fields.Item('Allegati').Value;$i=0;try{while(-not $child.EOF){$name=[IO.Path]::GetFileName([string]$child.Fields.Item('FileName').Value);$folder=Join-Path ([IO.Path]::GetTempPath()) ('aypi-supplier-'+[guid]::NewGuid().ToString('N'));[void][IO.Directory]::CreateDirectory($folder);$file=Join-Path $folder $name;try{$child.Fields.Item('FileData').SaveToFile($file);if((Get-Item -LiteralPath $file).Length -gt 20MB){throw 'Allegato Access oltre 20 MiB: importazione interrotta senza perdere dati.'};$attachments+=[ordered]@{id=([string]$rs.Fields.Item('ID').Value)+':'+$i;recordId=[string]$rs.Fields.Item('ID').Value;name=$name;dataBase64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($file))}}finally{if([IO.File]::Exists($file)){Remove-Item -LiteralPath $file};[IO.Directory]::Delete($folder)};$i++;$child.MoveNext()}}finally{$child.Close()};$rs.MoveNext()}}finally{$rs.Close()}
 $out=[ordered]@{version=1;readAt=(Get-Date).ToUniversalTime().ToString('o');suppliers=$suppliers;records=$records;levels=$levels;options=$options;config=$config;attachments=$attachments}
 [IO.File]::WriteAllText($Output,($out|ConvertTo-Json -Depth 15 -Compress),(New-Object Text.UTF8Encoding($false)))
}finally{$db.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($engine)}
