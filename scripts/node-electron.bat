@echo off
setlocal

set ELECTRON_RUN_AS_NODE=1

pushd %~dp0\..

set "ELECTRON="
for /f "usebackq delims=" %%a in (`node -p "require('electron')"`) do set "ELECTRON=%%a"

"%ELECTRON%" %*
set EXIT_CODE=%errorlevel%

popd

endlocal & exit /b %EXIT_CODE%
