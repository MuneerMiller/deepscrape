; DeepScrape Windows installer.
; Installs for the current user only (no administrator rights needed) and leaves saved scrapes alone on uninstall.
; Built by: npm run dist:win   (needs NSIS 3: makensis)
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef ROOT
  !define ROOT ".."
!endif
!ifndef SRC
  !define SRC "${ROOT}/dist/DeepScrape-win32-x64"
!endif
!ifndef OUT
  !define OUT "${ROOT}/dist/DeepScrape-Setup-${VERSION}.exe"
!endif
!ifndef SIZE_KB
  !define SIZE_KB 560000
!endif
!define APP "DeepScrape"
!define PUBLISHER "Mogamat Muneer Miller"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
BrandingText "${APP} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (c) ${PUBLISHER}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!define MUI_ICON "${ROOT}/build/icon.ico"
!define MUI_UNICON "${ROOT}/build/icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "DeepScrape scrapes a whole website on your own computer and lets you review and export what it finds.$\r$\n$\r$\nSetup installs it for your Windows account only. Your scrapes are saved in Documents\DeepScrape\data."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open DeepScrape"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${ROOT}/LICENSE.md"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Files cannot be replaced while the app is open, so wait for the owner to close it.
!macro WaitUntilClosed
  ${Do}
    ${IfNot} ${FileExists} "$INSTDIR\${APP}.exe"
      ${Break}
    ${EndIf}
    ClearErrors
    FileOpen $0 "$INSTDIR\${APP}.exe" a
    ${IfNot} ${Errors}
      FileClose $0
      ${Break}
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "DeepScrape is open. Close it, then choose Retry." IDRETRY +2
    Abort
  ${Loop}
!macroend

; Only the app's own files are removed, never the whole folder, in case it was installed into a folder that holds other things.
!macro RemoveAppFiles
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\version"
!macroend

Section "Install"
  !insertmacro WaitUntilClosed
  !insertmacro RemoveAppFiles
  SetOutPath "$INSTDIR"
  File /r "${SRC}/*.*"
  WriteUninstaller "$INSTDIR\Uninstall ${APP}.exe"

  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${APP}.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${APP}.exe"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP}.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${APP}.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://github.com/MuneerMiller/deepscrape"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" ${SIZE_KB}
SectionEnd

Section "Uninstall"
  !insertmacro WaitUntilClosed
  !insertmacro RemoveAppFiles
  Delete "$INSTDIR\Uninstall ${APP}.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
  MessageBox MB_OK|MB_ICONINFORMATION "DeepScrape was removed. Your saved scrapes are still in Documents\DeepScrape\data. Delete that folder yourself if you no longer want them."
SectionEnd
