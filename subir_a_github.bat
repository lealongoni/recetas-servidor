@echo off
title Subir Servidor a GitHub
cd /d "%~dp0"
echo ====================================================
echo  Subiendo archivos a: https://github.com/lealongoni/recetas-servidor.git
echo ====================================================
set "PATH=%LOCALAPPDATA%\MinGit\cmd;%PATH%"
git status
git add .
git commit -m "Preparar para Render"
git push -u origin main
echo ====================================================
echo  Proceso finalizado. Presiona cualquier tecla para cerrar.
echo ====================================================
pause
