; ─────────────────────────────────────────────────────────────────────────────
; YASCO ERP — NSIS installer hooks
;
; The desktop app ships its own Node runtime (node.exe) that listens on the
; loopback port 32145 and keeps its SQLite database under the install directory.
; If a previous instance (the app window and/or its sidecar) is still running,
; node.exe stays locked, so Windows shows:
;     "Error opening file for writing: ...\AppData\Local\YASCO ERP\node.exe"
; and clicking "Ignore" leaves the OLD sidecar running — the freshly installed
; app then keeps talking to stale code (e.g. an old, slowly-failing proxy).
;
; These hooks stop the running app and its loopback sidecar BEFORE the installer
; replaces files (and before the uninstaller removes them), so upgrades are clean
; and the new sidecar starts on a free port.
; ─────────────────────────────────────────────────────────────────────────────

; Stop the app window and whatever is listening on the loopback ERP port.
!macro __YASCO_STOP_RUNNING
  DetailPrint "Stopping any running YASCO ERP instance..."
  ; The app window itself (unique name, safe to kill by image name).
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "YASCO ERP.exe"'
  Pop $0
  ; The bundled Node sidecar holds port 32145 and locks node.exe. Killing the
  ; process that owns the LISTENING socket targets only our sidecar (never other
  ; Node apps the user may have open).
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 32145 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $$_.OwningProcess -Force -ErrorAction SilentlyContinue }"'
  Pop $0
  Sleep 1200
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro __YASCO_STOP_RUNNING
  ; Second pass: give processes a moment to release the file handle, then retry.
  !insertmacro __YASCO_STOP_RUNNING
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro __YASCO_STOP_RUNNING
!macroend
