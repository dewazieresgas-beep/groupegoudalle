@echo off
setlocal
title Serveur Intranet Groupe Goudalle
echo.
echo  ============================================
echo   Intranet Groupe Goudalle
echo  ============================================
echo.

cd /d "%~dp0server"

:: Verifie si Node.js est installe
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERREUR: Node.js n est pas installe !
    echo.
    echo Telecharger Node.js sur : https://nodejs.org
    echo Choisir la version LTS puis relancer ce fichier.
    echo.
    pause
    exit /b 1
)

:: Installe les dependances si besoin
if not exist "node_modules" (
    echo Installation des dependances en cours...
    npm install
    echo.
) else if not exist "node_modules\xlsx" (
    echo Installation de nouvelles dependances...
    npm install
    echo.
)

:: Libere le port 3000 si deja utilise
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo [INFO] Port 3000 occupe - Liberation en cours...
    taskkill /F /PID %%a >nul 2>&1
)

:: Lance le serveur
echo.
echo  Serveur demarre sur http://localhost:3000
echo  Pour acceder depuis le reseau : http://[IP]:3000
echo.
echo  Pour connaitre l IP du serveur : cmd puis "ipconfig"
echo.
echo  NE PAS FERMER CETTE FENETRE
echo.
:RESTART
echo [%date% %time%] Demarrage du serveur...
node server.js
set EXITCODE=%ERRORLEVEL%
echo.
echo [%date% %time%] Serveur arrete (code %EXITCODE%).
echo Redemarrage dans 5 secondes...
timeout /t 5 /nobreak >nul
goto RESTART

pause
