@echo off
setlocal enabledelayedexpansion

echo.
echo  ╔════════════════════════════════════════════════╗
echo  ║   Groupe Goudalle — Sync auto au démarrage    ║
echo  ╚════════════════════════════════════════════════╝
echo.

:: Nom de la tâche = nom du dossier chantier
for %%I in ("%~dp0.") do set DOSSIER=%%~nxI
set TASK_NAME=GoudalleSync_%DOSSIER%

:: Vérifier que Node.js est installé
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo  [ERREUR] Node.js n'est pas installe.
  echo  Telechargez-le sur : https://nodejs.org
  echo.
  pause
  exit /b 1
)

:: Vérifier que sync-config.json est configuré
findstr /C:"ADRESSE-SERVEUR" "%~dp0sync-config.json" >nul 2>&1
if %errorlevel% equ 0 (
  echo  [ERREUR] sync-config.json n'est pas configure.
  echo  Ouvrir sync-config.json et remplir serverUrl et companyWifi.
  echo.
  pause
  exit /b 1
)

:: Créer la tâche planifiée (lancement à la connexion Windows)
schtasks /create /tn "%TASK_NAME%" /tr "node \"%~dp0sync.js\"" /sc onlogon /ru "%USERNAME%" /f >nul 2>&1

if %errorlevel% equ 0 (
  echo  [OK] Synchronisation automatique activée !
  echo.
  echo  Dossier : %~dp0
  echo  Tâche   : %TASK_NAME%
  echo.
  echo  La sync démarrera automatiquement à chaque connexion Windows.
  echo  Dès que le WiFi entreprise est détecté, ce chantier est synchronisé.
  echo.
  echo  Pour désactiver :
  echo    schtasks /delete /tn "%TASK_NAME%" /f
) else (
  echo  [ERREUR] Exécuter ce fichier en tant qu'administrateur
  echo  ^(clic droit sur installer.bat → Exécuter en tant qu'administrateur^)
)

echo.
pause
