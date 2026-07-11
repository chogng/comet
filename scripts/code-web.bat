@echo off
setlocal

title Comet Studio Web

pushd %~dp0\..

:parseArguments
if "%~1"=="" goto checkExistingServer
if /I "%~1"=="--port" (
	set WEB_PORT=%~2
	shift
	shift
	goto parseArguments
)
set ARGUMENT=%~1
if /I "%ARGUMENT:~0,7%"=="--port=" set WEB_PORT=%ARGUMENT:~7%
shift
goto parseArguments

:checkExistingServer
if not defined WEB_PORT set WEB_PORT=5173
set WEB_URL=http://127.0.0.1:%WEB_PORT%/
curl.exe --fail --silent --max-time 2 "%WEB_URL%" | findstr /C:"<title>Comet Studio</title>" >nul
if errorlevel 1 goto startServer

echo Stopping existing Comet Studio Web server at %WEB_URL%
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /C:":%WEB_PORT% " ^| findstr /C:"LISTENING"') do taskkill /PID %%P /T /F >nul

set RETRIES=0
:waitForPort
set LISTENING=
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /C:":%WEB_PORT% " ^| findstr /C:"LISTENING"') do set LISTENING=1
if not defined LISTENING goto startServer
set /a RETRIES+=1
if %RETRIES% GEQ 10 (
	echo Unable to stop the existing Comet Studio Web server at %WEB_URL% >&2
	popd
	endlocal & exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitForPort

:startServer
node .\node_modules\vite\bin\vite.js --config .\vite.web.config.ts %*
set EXIT_CODE=%errorlevel%

popd

endlocal & exit /b %EXIT_CODE%
