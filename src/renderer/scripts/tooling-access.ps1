param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
$engine=New-Object -ComObject DAO.DBEngine.120
$db=$engine.OpenDatabase($Source,$false,$true)
try {
 $tables=@()
 foreach($name in @('tblUtensili','tblArticoli','tblArticoliUtensili','tblClienti','tblClientiUtensili','tblFornitori','tblFornitoriUtensili','tblUtensileTipo')){
  $rs=$db.OpenRecordset('SELECT * FROM ['+$name+']',4);$rows=@()
  try{while(-not $rs.EOF){$row=[ordered]@{};foreach($f in $rs.Fields){$v=$f.Value;$row[$f.Name]=if($null -eq $v -or $v -is [DBNull]){$null}elseif($v -is [DateTime]){$v.ToString('yyyy-MM-dd')}else{$v}};$rows+=,[pscustomobject]$row;$rs.MoveNext()}}finally{$rs.Close()}
  $tables+=@{name=$name;rows=$rows}
 }
 $result=@{version=1;source=$Source;readAt=(Get-Date).ToUniversalTime().ToString('o');tables=$tables}
 [IO.File]::WriteAllText($Output,($result|ConvertTo-Json -Depth 20 -Compress),(New-Object Text.UTF8Encoding($false)))
}finally{$db.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($db);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($engine)}
