@echo off
setlocal
title Instalar WillyPost
rem WillyPost - lo que ejecuta "Instalar-WillyPost.exe" (paquete IExpress, ver build-exe.ps1).
rem Solo lanza descargar-e-instalar.ps1, que descarga la ultima version de GitHub y ejecuta
rem scripts\windows\instalar.ps1 de siempre. No necesita permisos de administrador.
rem (Este archivo es solo ASCII a proposito: asi se ve bien en cualquier Windows.)
rem Pruebas: DRYRUN=1, WILLYPOST_ZIP_URL=<url o ruta de un zip>, WILLYPOST_NO_PAUSE=1 (no espera una tecla).
pushd "%~dp0" 2>nul
rem Si este proceso fuera de 32 bits, usar el PowerShell de 64 bits (Sysnative solo existe en ese caso).
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "PSEXE=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PSEXE%" set "PSEXE=powershell.exe"
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0descargar-e-instalar.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo   El instalador se ha detenido antes de terminar. Lee el mensaje de arriba.
  echo   Puedes volver a abrir "Instalar-WillyPost.exe": repite solo lo que faltaba.
  echo   Si ves texto en rojo que habla de "scripts" o "directivas", tu ordenador
  echo   ^(de empresa o colegio^) bloquea instaladores: escribe a nuria.olive@gmail.com.
  echo.
)
if "%WILLYPOST_NO_PAUSE%"=="1" goto fin
echo   Pulsa una tecla para cerrar esta ventana.
pause >nul
:fin
popd 2>nul
exit /b %RC%
