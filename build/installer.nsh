; LIB Browser — NSIS installer additions (included by electron-builder).
; Registers LIB Browser as a web browser so it appears in Windows
; Settings › Apps › Default apps and can open http/https links and .html files.

!macro customInstall
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser" "" "LIB Browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'

  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities" "ApplicationName" "LIB Browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities" "ApplicationDescription" "A fast, private, beautiful web browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities\StartMenu" "StartMenuInternet" "LIBBrowser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities\URLAssociations" "http" "LIBBrowserURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities\URLAssociations" "https" "LIBBrowserURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities\FileAssociations" ".htm" "LIBBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities\FileAssociations" ".html" "LIBBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities\FileAssociations" ".xhtml" "LIBBrowserHTML"

  WriteRegStr SHCTX "Software\Classes\LIBBrowserURL" "" "LIB Browser URL"
  WriteRegStr SHCTX "Software\Classes\LIBBrowserURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\LIBBrowserURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\LIBBrowserURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr SHCTX "Software\Classes\LIBBrowserHTML" "" "LIB Browser HTML Document"
  WriteRegStr SHCTX "Software\Classes\LIBBrowserHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\LIBBrowserHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr SHCTX "Software\RegisteredApplications" "LIB Browser" "Software\Clients\StartMenuInternet\LIBBrowser\Capabilities"

  ; Tell Explorer that associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\LIBBrowser"
  DeleteRegKey SHCTX "Software\Classes\LIBBrowserURL"
  DeleteRegKey SHCTX "Software\Classes\LIBBrowserHTML"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "LIB Browser"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
