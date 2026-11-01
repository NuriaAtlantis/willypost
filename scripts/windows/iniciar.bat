@echo off
setlocal
chcp 65001 >nul
rem WillyPost - arranca el servidor y abre el navegador.
rem   iniciar.bat            -> arranca en segundo plano (sin ventana) y abre http://localhost:4747
rem   iniciar.bat visible    -> lo ejecuta en ESTA ventana, para ver los mensajes (solo para depurar)
rem   DRYRUN=1               -> solo muestra lo que haria
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
if not defined WILLYPOST_PORT set "WILLYPOST_PORT=4747"
set "URL=http://localhost:%WILLYPOST_PORT%"

rem ---- Si ya esta en marcha, solo abrimos el navegador
curl.exe -s -m 2 --noproxy "*" "http://127.0.0.1:%WILLYPOST_PORT%/api/health" 2>nul | findstr /R "ok.*true" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   WillyPost ya estaba abierto. Abriendo %URL% ...
  if "%DRYRUN%"=="1" ( echo   [DRYRUN] start %URL% ) else ( start "" "%URL%" )
  exit /b 0
)

rem ---- Buscar Node (el portable de la instalacion, o el del sistema si es 22.13 o superior)
set "NODE=%ROOT%\runtime\node\node.exe"
if not exist "%NODE%" (
  set "NODE=node"
  node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo   No encuentro Node.js. Haz doble clic en "Instalar WillyPost" para repararlo.
    pause
    exit /b 1
  )
)

echo.
echo   Arrancando WillyPost...
if "%DRYRUN%"=="1" (
  echo   [DRYRUN] cd /d "%ROOT%"
  echo   [DRYRUN] "%NODE%" --disable-warning=ExperimentalWarning server/index.js
  echo   [DRYRUN] start %URL%
  exit /b 0
)

if /i "%~1"=="visible" (
  cd /d "%ROOT%"
  start "" "%URL%"
  "%NODE%" --disable-warning=ExperimentalWarning server/index.js
  pause
  exit /b 0
)

wscript.exe //nologo "%~dp0iniciar-oculto.vbs" abrir
exit /b 0
