@echo off
setlocal
title Intranet Groupe Goudalle - Serveur
echo.
echo  ============================================
echo   Intranet Groupe Goudalle - Demarrage
echo  ============================================
echo.

cd /d "%~dp0server"

:: Vérifie si Node.js est installé
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERREUR: Node.js n'est pas installe !
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

:: Lance le serveur
echo  Serveur demarre sur http://localhost:3000
echo  Pour acceder depuis le reseau : http://[IP-DU-SERVEUR]:3000
echo.
echo  Pour connaitre l'IP du serveur : ouvrir cmd et taper "ipconfig"
echo.
echo  NE PAS FERMER CETTE FENETRE (le serveur s'arrete sinon)
echo.
:RESTART
echo [%date% %time%] Demarrage du serveur...
node server.js
set EXITCODE=%ERRORLEVEL%
echo.
echo [%date% %time%] ATTENTION: serveur arrete (code %EXITCODE%).
echo Redemarrage automatique dans 5 secondes...
timeout /t 5 /nobreak >nul
goto RESTART

pause
