@echo off
rem ===================================================================
rem  Formulaire Assurance TNS Pro - lanceur Windows
rem  Double-cliquez sur ce fichier : le serveur local demarre (relais
rem  d'API inclus) et le navigateur ouvre le formulaire, localisateur
rem  d'entreprises compris.
rem  N'ouvrez PAS index.html en double-cliquant : le localisateur est un
rem  module JavaScript, il exige une adresse http://.
rem ===================================================================
setlocal
cd /d "%~dp0.."
title Formulaire Assurance TNS Pro

echo.
echo   ============================================================
echo    Formulaire Assurance TNS Pro
echo    Etape « Localisez votre entreprise » (localisateur integre)
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

echo   [ERREUR] Node.js n'est pas installe.
echo   Installez-le gratuitement : https://nodejs.org
echo.
pause
exit /b 1

:avec_node
set STATIC_ROOT=.
echo   [OK] Node.js detecte. Demarrage du serveur local...
echo   Le navigateur va s'ouvrir sur le formulaire.
echo   Pour arreter : Ctrl + C
echo.
node company-locator\server.js --open --path assurance-tns-pro-v2-adw/
goto :fin

:avec_python
echo   [!] Node.js absent : serveur statique Python (mode degrade).
echo       Le relais d'API local est indisponible : certaines recherches
echo       peuvent etre bloquees. Installez Node.js : https://nodejs.org
echo.
start "" http://localhost:8080/assurance-tns-pro-v2-adw/
python -m http.server 8080
goto :fin

:avec_py
echo   [!] Node.js absent : serveur statique Python (mode degrade).
start "" http://localhost:8080/assurance-tns-pro-v2-adw/
py -m http.server 8080
goto :fin

:fin
echo.
echo   Serveur arrete.
pause
