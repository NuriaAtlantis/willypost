@echo off
title Detener WillyPost
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0detener.ps1"
echo.
echo   Pulsa una tecla para cerrar esta ventana.
pause >nul
