@echo off
setlocal
title Instalar WillyPost
pushd "%~dp0" 2>nul
rem WillyPost - instalador de Windows. Solo lanza scripts\windows\instalar.ps1 (no necesita permisos de administrador).
rem Para probarlo sin cambiar nada:  set DRYRUN=1  y despues ejecutar este archivo.
rem (Este archivo es solo ASCII a proposito: asi se ve bien en cualquier Windows.)
if not exist "%~dp0scripts\windows\instalar.ps1" (
  echo.
  echo   ==================================================
  echo    No encuentro los archivos de instalacion.
  echo   ==================================================
  echo.
  echo   Lo mas probable: has abierto este archivo DENTRO del ZIP.
  echo   Primero hay que DESCOMPRIMIR el ZIP:
  echo.
  echo     1. Cierra esta ventana.
  echo     2. Clic derecho sobre el ZIP descargado y elige "Extraer todo..."
  echo     3. Pulsa "Extraer" y abre la carpeta nueva que aparece.
  echo     4. Ahora si: doble clic en "Instalar WillyPost".
  echo.
  echo   Si ya lo habias descomprimido, comprueba que no has movido este
  echo   archivo fuera de su carpeta: tiene que estar junto a las carpetas
  echo   "scripts", "server" y "web".
  echo.
  echo   Pulsa una tecla para cerrar esta ventana.
  pause >nul
  exit /b 1
)
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PSEXE%" set "PSEXE=powershell.exe"
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\instalar.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo   El instalador se ha detenido antes de terminar. Lee el mensaje de arriba.
  echo   Puedes volver a hacer doble clic en "Instalar WillyPost": repite solo lo que faltaba.
  echo   Si ves texto en rojo que habla de "scripts" o "directivas", tu ordenador
  echo   ^(de empresa o colegio^) bloquea instaladores: escribe a nuria.olive@gmail.com.
  echo.
)
echo   Pulsa una tecla para cerrar esta ventana.
pause >nul
popd 2>nul
exit /b %RC%
