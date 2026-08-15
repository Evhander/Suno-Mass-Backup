@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Suno Mass Backup - Instalador rapido

set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\SunoMassBackup"

echo ============================================================
echo       SUNO MASS BACKUP - INSTALADOR RAPIDO
echo ============================================================
echo.
echo Este instalador copiara la extension a:
echo %DEST%
echo.
echo Chrome requiere que una extension descargada desde GitHub se cargue
echo manualmente con "Cargar descomprimida".
echo.
pause

if not exist "%DEST%" mkdir "%DEST%"

echo Copiando archivos...
xcopy "%SRC%manifest.json" "%DEST%\" /Y >nul
xcopy "%SRC%background.js" "%DEST%\" /Y >nul
xcopy "%SRC%popup.html" "%DEST%\" /Y >nul
xcopy "%SRC%popup.css" "%DEST%\" /Y >nul
xcopy "%SRC%popup.js" "%DEST%\" /Y >nul

echo %DEST% | clip

echo.
echo LISTO.
echo.
echo 1. Se abrira chrome://extensions/
echo 2. Activa "Modo de desarrollador"
echo 3. Pulsa "Cargar descomprimida"
echo 4. Pega esta ruta, que ya esta en el portapapeles:
echo.
echo    %DEST%
echo.
start "" chrome "chrome://extensions/"
start "" explorer "%DEST%"
echo.
pause
