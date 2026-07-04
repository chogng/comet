@echo off
setlocal

title Comet Studio Dev

pushd %~dp0\..

set NODE_ENV=development
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

node .\node_modules\tsx\dist\cli.mjs build\lib\preLaunch.ts %*
set EXIT_CODE=%errorlevel%

popd

endlocal & exit /b %EXIT_CODE%
