param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Output,[string]$AttachmentRoot='')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
function Scalar($value) { if($null -eq $value -or $value -is [DBNull]){return $null};if($value -is [DateTime]){return $value.ToString('yyyy-MM-dd')};return $value }
function ReadTable($db,[string]$table,[hashtable]$columns) {
    $rs=$db.OpenRecordset('SELECT * FROM ['+$table+']',4)
    try { while(-not $rs.EOF){
        $row=[ordered]@{}
        foreach($key in $columns.Keys){
            $field=$rs.Fields.Item($columns[$key])
            if($field.Type -eq 109){$values=@();$child=$field.Value;try{while(-not $child.EOF){$values+=[string]$child.Fields.Item('Value').Value;$child.MoveNext()}}finally{$child.Close()};$row[$key]=$values}
            else{$row[$key]=Scalar $field.Value}
        }
        [pscustomobject]$row
        $rs.MoveNext()
    }}finally{$rs.Close()}
}
$engine=New-Object -ComObject DAO.DBEngine.120
$db=$engine.OpenDatabase($Source,$false,$true)
try {
    $machines=@(ReadTable $db 'tblMacchine' @{id='Codice Interno';code='Codice Interno';department='Reparto';description='Identificativo Macchina';year='Anno di Costruzione';responsible='Responsabile Incaricato';serial='Matricola';robotSerial='Matricola Robot/Forno';islandSerial='Matricola Isola Robotizzata';equipmentTypes='Tipo di Attrezzatura';conformity='Dichiarazione di Conformità';robotConformity='Conformità Robot'})
    $plans=@(ReadTable $db 'tblListaManutenzioniOrdinarie' @{id='ID';machineId='Macchina';description='Manutenzione'})
    $ordinary=@(ReadTable $db 'tblManutenzioniOrdinarie' @{id='ID';machineId='Macchina';planId='Manutenzione';date='Data';legacyNextDate='Prossima Manutenzione'})
    $extraordinary=@(ReadTable $db 'tblManutenzioniStraordinarie' @{id='ID';machineId='Macchina';date='Data';description='Intervento';notes='Note'})
    $departments=@(ReadTable $db 'tblReparti' @{name='Reparto'})
    $equipmentTypes=@(ReadTable $db 'tblTipiAttrezzature' @{name='Tipi di Attrezzature'})
    if(-not $AttachmentRoot){$AttachmentRoot=Split-Path -LiteralPath $Source}
    $files=@(Get-ChildItem -LiteralPath $AttachmentRoot -Recurse -File | Where-Object {$_.Extension -ne '.accdb' -and $_.Extension -ne '.laccdb'})
    $attachments=@();$rs=$db.OpenRecordset('SELECT [ID],[Allegati] FROM [tblManutenzioniStraordinarie]',4)
    try{while(-not $rs.EOF){$child=$rs.Fields.Item('Allegati').Value;$index=0
        try{while(-not $child.EOF){
            $name=[string]$child.Fields.Item('FileName').Value
            $matches=@($files|Where-Object Name -eq $name)
            $attachment=[ordered]@{id=([string]$rs.Fields.Item('ID').Value)+':'+$index;recordId='extraordinary:'+([string]$rs.Fields.Item('ID').Value);name=$name;path=$null;data=$null}
            if($matches.Count -eq 1){$attachment.path=$matches[0].FullName}
            else{
                $temporaryDir=Join-Path ([IO.Path]::GetTempPath()) ('aypi-maintenance-'+[guid]::NewGuid().ToString('N'))
                [void][IO.Directory]::CreateDirectory($temporaryDir)
                $temporaryFile=Join-Path $temporaryDir ([IO.Path]::GetFileName($name))
                try{
                    $child.Fields.Item('FileData').SaveToFile($temporaryFile)
                    $hash=(Get-FileHash -LiteralPath $temporaryFile -Algorithm SHA256).Hash
                    $same=@($matches|Where-Object {(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash -eq $hash})
                    if($same.Count -gt 0){$attachment.path=$same[0].FullName}
                    else{$attachment.data=[Convert]::ToBase64String([IO.File]::ReadAllBytes($temporaryFile))}
                }finally{if([IO.File]::Exists($temporaryFile)){Remove-Item -LiteralPath $temporaryFile -Force};Remove-Item -LiteralPath $temporaryDir -Force}
            }
            $attachments+=[pscustomobject]$attachment;$index++;$child.MoveNext()
        }}finally{$child.Close()};$rs.MoveNext()
    }}finally{$rs.Close()}
    $result=[ordered]@{version=1;source=$Source;readAt=(Get-Date).ToUniversalTime().ToString('o');machines=$machines;plans=$plans;ordinary=$ordinary;extraordinary=$extraordinary;departments=$departments;equipmentTypes=$equipmentTypes;attachments=$attachments}
    [IO.File]::WriteAllText($Output,($result|ConvertTo-Json -Depth 12 -Compress),(New-Object Text.UTF8Encoding($false)))
}finally{$db.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($db);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($engine)}
