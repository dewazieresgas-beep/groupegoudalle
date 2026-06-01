@echo off
title Sync Goudalle — %~dp0
echo.
echo  Synchronisation manuelle du dossier chantier...
echo  (Fermer cette fenêtre pour arrêter)
echo.
node "%~dp0sync.js"
pause
