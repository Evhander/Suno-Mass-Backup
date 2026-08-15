@echo off
title Suno Mass Backup - Update
chcp 65001 >nul
echo ============================================================
echo      UPDATE WITHOUT UNINSTALLING THE EXTENSION
echo ============================================================
echo.
echo IMPORTANT: do not click "Remove" in Chrome.
echo.
echo Copy the files from this folder OVER the folder Chrome already has
loaded, accept replacement, and then click RELOAD in chrome://extensions/
echo.
echo The first time you move to this version, run one FULL SCAN.
echo After that you can choose Likes or All without rescanning.
echo.
pause
start "" chrome "chrome://extensions/"
