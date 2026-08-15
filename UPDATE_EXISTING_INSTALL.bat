@echo off
title Suno Mass Backup - Actualizacion
chcp 65001 >nul
echo ============================================================
echo      ACTUALIZAR SIN DESINSTALAR LA EXTENSION
echo ============================================================
echo.
echo IMPORTANTE: no pulses "Quitar" en Chrome.
echo.
echo Copia los archivos de esta carpeta ENCIMA de la carpeta que Chrome
echo ya tiene cargada, acepta reemplazar y luego pulsa RECARGAR en
echo chrome://extensions/
echo.
echo La primera vez que pases a esta version haz un ESCANEO COMPLETO.
echo Despues podras elegir Likes o Todo sin volver a escanear.
echo.
pause
start "" chrome "chrome://extensions/"
