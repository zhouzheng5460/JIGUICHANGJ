@echo off
REM Rack3D dev server launcher
REM Double-click this file to start Vite on http://localhost:5200/
REM (--strictPort: 端口被占用时直接报错，不会静默漂到 5201 让人找不到地址)
cd /d G:\Rackula-main\Rackula-main
set VITE_CONFIG_NATIVE_IGNORE_WARNING=true
npm run dev -- --port 5200 --strictPort
pause
