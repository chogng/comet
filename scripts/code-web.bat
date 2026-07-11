@echo off
setlocal

title Comet Studio Web

pushd %~dp0\..

node .\node_modules\vite\bin\vite.js --config .\vite.web.config.ts %*
set EXIT_CODE=%errorlevel%

popd

endlocal & exit /b %EXIT_CODE%
