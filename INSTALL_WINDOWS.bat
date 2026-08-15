@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Suno Mass Backup - Quick Installer

set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\SunoMassBackup"

echo ============================================================
echo       SUNO MASS BACKUP - QUICK INSTALLER
echo ============================================================
echo.
echo This installer will copy the extension to:
echo %DEST%
echo.
echo Chrome requires GitHub-downloaded extensions to be loaded manually
echo using "Load unpacked".
echo.
pause

if not exist "%DEST%" mkdir "%DEST%"

echo Copying files...
xcopy "%SRC%manifest.json" "%DEST%\" /Y >nul
xcopy "%SRC%background.js" "%DEST%\" /Y >nul
xcopy "%SRC%popup.html" "%DEST%\" /Y >nul
xcopy "%SRC%popup.css" "%DEST%\" /Y >nul
xcopy "%SRC%popup.js" "%DEST%\" /Y >nul

echo %DEST% | clip

echo.
echo READY.
echo.
echo 1. chrome://extensions/ will open.
echo 2. Enable "Developer mode".
echo 3. Click "Load unpacked".
echo 4. Paste this path, which is already in your clipboard:
echo.
echo    %DEST%
echo.
start "" chrome "chrome://extensions/"
start "" explorer "%DEST%"
echo.
pause
