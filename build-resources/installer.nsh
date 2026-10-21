; Native shell integration for Explorer and third-party file managers.
!define SVN_SHELL_CLSID "{418857DD-E05B-4B84-9B24-59282A539CE4}"
!define SVN_OLD_SHELL_CLSID "{2C8C9A51-2A15-4D3B-9E6B-9F2E3B5A6C10}"

!macro RegisterNonuquShell BITS
  SetRegView ${BITS}
  DeleteRegKey HKCU "Software\Classes\CLSID\${SVN_OLD_SHELL_CLSID}"
  DeleteRegKey HKCU "Software\Classes\NonuquShellExtension"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NonuquSVN"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\NonuquSVN Log"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NonuquSVN"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\NonuquSVN Log"
  WriteRegStr HKCU "Software\Classes\CLSID\${SVN_SHELL_CLSID}" "" "NonuquSVN context menu"
  WriteRegStr HKCU "Software\Classes\CLSID\${SVN_SHELL_CLSID}\InprocServer32" "" "$INSTDIR\resources\NonuquShellExtension${BITS}.dll"
  WriteRegStr HKCU "Software\Classes\CLSID\${SVN_SHELL_CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  WriteRegStr HKCU "Software\Classes\Directory\shellex\ContextMenuHandlers\NonuquSVN" "" "${SVN_SHELL_CLSID}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shellex\ContextMenuHandlers\NonuquSVN" "" "${SVN_SHELL_CLSID}"
  WriteRegStr HKCU "Software\Classes\Folder\shellex\ContextMenuHandlers\NonuquSVN" "" "${SVN_SHELL_CLSID}"
  WriteRegStr HKCU "Software\Classes\Drive\shellex\ContextMenuHandlers\NonuquSVN" "" "${SVN_SHELL_CLSID}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" "${SVN_SHELL_CLSID}" "NonuquSVN"
!macroend

!macro UnregisterNonuquShell BITS
  SetRegView ${BITS}
  DeleteRegKey HKCU "Software\Classes\Directory\shellex\ContextMenuHandlers\NonuquSVN"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shellex\ContextMenuHandlers\NonuquSVN"
  DeleteRegKey HKCU "Software\Classes\Folder\shellex\ContextMenuHandlers\NonuquSVN"
  DeleteRegKey HKCU "Software\Classes\Drive\shellex\ContextMenuHandlers\NonuquSVN"
  DeleteRegKey HKCU "Software\Classes\CLSID\${SVN_SHELL_CLSID}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" "${SVN_SHELL_CLSID}"
!macroend

!macro customInstall
  !insertmacro RegisterNonuquShell 64
  !insertmacro RegisterNonuquShell 32
  SetRegView 64
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUninstall
  !insertmacro UnregisterNonuquShell 64
  !insertmacro UnregisterNonuquShell 32
  SetRegView 64
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
