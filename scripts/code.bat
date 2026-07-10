@echo off
setlocal

title Comet Studio Dev

pushd %~dp0\..

node .\node_modules\tsx\dist\cli.mjs build\lib\devDesktop.ts %*
set EXIT_CODE=%errorlevel%

popd

endlocal & exit /b %EXIT_CODE%
