param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$engine=New-Object -ComObject DAO.DBEngine.120
$db=$engine.OpenDatabase($Source,$false,$true)
try {
    $columns=@{code='CodiceInterno';description='Descrizione';serial='Matricola';category='Categoria';location='Locazione';model='Modello';measurementRange='CampoMisuraStrumento';useRange='CampoMisuraInUso';resolution='Sensibilità';tolerance='TolleranzaRichiesta';frequencyYears='FrequenzaTaratura';calibrationMode='Taratura';method='MetodoTaratura';lastDate='DataultimaTaratura';nextDate='ProssimaTaratura';usage='StatoUtilizzo';notes='Note';suitability='Idoneità'}
    $rows=@();$rs=$db.OpenRecordset('SELECT * FROM [tblStrumenti]',4)
    try {while(-not $rs.EOF){$row=[ordered]@{};foreach($key in $columns.Keys){$value=$rs.Fields.Item($columns[$key]).Value;$row[$key]=if($null -eq $value -or $value -is [DBNull]){$null}elseif($value -is [DateTime]){$value.ToString('yyyy-MM-dd')}else{$value}};$rows+=[pscustomobject]$row;$rs.MoveNext()}}finally{$rs.Close()}
    $result=@{version=1;source=$Source;readAt=(Get-Date).ToUniversalTime().ToString('o');instruments=$rows}
    [IO.File]::WriteAllText($Output,($result|ConvertTo-Json -Depth 12 -Compress),(New-Object Text.UTF8Encoding($false)))
}finally{$db.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($db);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($engine)}
