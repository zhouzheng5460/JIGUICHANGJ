@echo off
REM Rack3D dev server - headless launcher (no pause).
REM Intended to be started by Windows Task Scheduler or by hand.
REM Keeps the server outside any shell's process tree so it is not recycled.
cd /d G:\Rackula-main\Rackula-main
set VITE_CONFIG_NATIVE_IGNORE_WARNING=true
set NO_COLOR=1
"C:\Program Files\nodejs\node.exe" node_modules\vite\bin\vite.js --port 5200 --strictPort > "%TEMP%\rack3d-vite5200.log" 2>&1
exit /b %errorlevel%
