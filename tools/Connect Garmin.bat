@echo off
setlocal
title Janos Health - connect Garmin
cd /d "%~dp0"
echo.
echo  Janos Health: one-time Garmin login
echo  -----------------------------------
echo.
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python isn't installed yet. Installing it now, this takes a minute...
  echo.
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  echo.
  echo Done. Close this window and double-click "Connect Garmin.bat" again.
  echo If it still says Python isn't installed: install Python from python.org, tick "Add python.exe to PATH", then try again.
  echo.
  pause
  exit /b
)
echo Getting the Garmin library ready...
%PY% -m pip install --disable-pip-version-check --quiet --upgrade garminconnect
if errorlevel 1 (
  echo.
  echo Couldn't install the Garmin library. Send Claude a screenshot of this window.
  pause
  exit /b
)
echo.
%PY% get_garmin_tokens.py
echo.
pause
