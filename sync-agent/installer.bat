@echo off
setlocal

echo.
echo  ╔════════════════════════════════════════════════╗
echo  ║    Agent de synchronisation Goudalle           ║
echo  ║    Installation automatique au démarrage       ║
echo  ╚════════════════════════════════════════════════╝
echo.

:: Vérifier config.json
if not exist "%~dp0config.json" (
  echo  [ERREUR] config.json introuvable !
  echo  Copiez config.example.json en config.json et remplissez-le d'abord.
  echo.
  pause
  exit /b 1
)

:: Vérifier Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo  [ERREUR] Node.js n'est pas installé.
  echo  Téléchargez-le sur https://nodejs.org puis relancez ce script.
  echo.
  pause
  exit /b 1
)

:: Créer la tâche planifiée (lancement à la connexion Windows)
schtasks /create /tn "GoudalleSync" /tr "node \"%~dp0sync.js\"" /sc onlogon /ru "%USERNAME%" /f >nul 2>&1

if %errorlevel% equ 0 (
  echo  [OK] Agent installé avec succès !
  echo.
  echo  L'agent démarrera automatiquement à chaque connexion Windows.
  echo  Il synchronise tous les dossiers chantier dès que le WiFi entreprise est détecté.
  echo.
  echo  Vous pouvez aussi le lancer maintenant : node "%~dp0sync.js"
  echo  Les logs sont dans : %~dp0sync.log
) else (
  echo  [ERREUR] Installation échouée.
  echo  Essayez d'exécuter ce fichier en tant qu'administrateur ^(clic droit → Exécuter en tant qu'administrateur^).
)

echo.
pause
