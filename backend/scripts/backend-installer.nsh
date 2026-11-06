!macro customInstall
  DetailPrint "Configurazione del collegamento SQL aziendale..."
  nsExec::ExecToStack 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\backend-scripts\install-sql-analytics.ps1"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Configurazione SQL non riuscita.$\r$\n$\r$\n$1"
    Abort
  ${EndIf}
  DetailPrint "Configurazione dell'avvio automatico di AyPi Backend..."
  nsExec::ExecToStack 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\backend-scripts\install-server-task.ps1" -ExePath "$INSTDIR\AyPi Backend.exe"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Impossibile configurare l'avvio automatico di AyPi Backend.$\r$\n$\r$\n$1"
    Abort
  ${EndIf}
!macroend

!macro customUnInit
  DetailPrint "Rimozione dell'avvio automatico di AyPi Backend..."
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\backend-scripts\uninstall-server-task.ps1"'
!macroend
