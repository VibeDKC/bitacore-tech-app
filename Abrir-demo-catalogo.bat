@echo off
setlocal
cd /d "%~dp0web"
if not exist node_modules (
  echo Instalando dependencias de la demo...
  call npm install
)
start "BitacoreTech Demo" cmd /k "npm run dev"
timeout /t 6 /nobreak >nul
start "" "http://localhost:3001"
endlocal
