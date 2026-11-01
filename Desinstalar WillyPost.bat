@echo off
setlocal
title Desinstalar WillyPost
pushd "%~dp0" 2>nul
rem WillyPost - desinstalador de Windows. Solo lanza scripts\windows\desinstalar.ps1
if not exist "%~dp0scripts\windows\desinstalar.ps1" (
  echo.
  echo   No encuentro los archivos del desinstalador.
  echo   Usa el icono "Desinstalar WillyPost" del menu Inicio, o
  echo   "Configuracion ^> Aplicaciones ^> WillyPost ^> Desinstalar".
  echo.
  echo   Pulsa una tecla para cerrar esta ventana.
  pause >nul
  exit /b 1
)
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PSEXE%" set "PSEXE=powershell.exe"
rem Todo lo que sigue va en UN bloque: cmd lo lee entero antes de ejecutarlo, asi no falla
rem aunque este mismo archivo ya se haya borrado de la carpeta de instalacion.
(
  "%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\desinstalar.ps1" %*
  popd 2>nul
  cd /d "%TEMP%" 2>nul
  echo.
  echo   Pulsa una tecla para cerrar esta ventana.
  pause >nul
  exit /b 0
)
