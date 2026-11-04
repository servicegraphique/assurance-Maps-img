@echo off
rem ===================================================================
rem  Company Locator France - lanceur Windows
rem  Double-cliquez sur ce fichier : le serveur local demarre et le
rem  navigateur s'ouvre sur la bonne adresse.
rem  N'ouvrez JAMAIS index.html directement (file://) : les navigateurs
rem  y bloquent les modules JavaScript.
rem ===================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Company Locator France
color 0B

echo.
echo   ============================================================
echo    Company Locator France
echo    Recherche, geolocalisation et imagerie d'entreprises
echo   ============================================================
echo.
echo   Dossier : %CD%
echo.

where node >nul 2>nul
if %errorlevel%==0 goto :avec_node

where python >nul 2>nul
if %errorlevel%==0 goto :avec_python

where py >nul 2>nul
if %errorlevel%==0 goto :avec_py

goto :rien

:avec_node
echo   [OK] Node.js detecte. Demarrage du serveur local...
echo   Le navigateur va s'ouvrir automatiquement.
echo   Pour arreter : fermez cette fenetre ou appuyez sur Ctrl + C.
echo.
node server.js --open
goto :fin

:avec_python
echo   [!] Node.js est absent : demarrage en MODE DEGRADE avec Python.
echo.
echo       Dans ce mode, la recherche d'entreprises peut etre bloquee
echo       par le navigateur (CORS) et Mapillary est indisponible.
echo       Installez Node.js (gratuit) pour un fonctionnement complet :
echo       https://nodejs.org
echo.
start "" http://localhost:8080/
python -m http.server 8080
goto :fin

:avec_py
echo   [!] Node.js est absent : demarrage en MODE DEGRADE avec Python.
echo       Installez Node.js (gratuit) : https://nodejs.org
echo.
start "" http://localhost:8080/
py -m http.server 8080
goto :fin

:rien
color 0C
echo   [ERREUR] Ni Node.js ni Python n'est installe sur ce poste.
echo.
echo   Solution recommandee :
echo     1. Telechargez Node.js gratuitement sur https://nodejs.org
echo     2. Installez-le (options par defaut), puis fermez cette fenetre
echo     3. Double-cliquez a nouveau sur ce fichier
echo.
echo   Aucun abonnement, aucune inscription n'est necessaire.
echo.

:fin
echo.
echo   Le serveur est arrete. Vous pouvez fermer cette fenetre.
pause >nul
endlocal
