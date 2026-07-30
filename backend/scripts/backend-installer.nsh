!macro customInstall
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
