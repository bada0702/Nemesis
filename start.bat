@echo off
setlocal enabledelayedexpansion

set ROOT=%~dp0
set FRONTEND=%ROOT%frontend
set API_PORT=18080
set UI_PORT=5173
set VITE_JS=%FRONTEND%\node_modules\vite\bin\vite.js

set CMD=%1
if "%CMD%"=="" set CMD=start
if /i "%CMD%"=="start"   goto DO_START
if /i "%CMD%"=="stop"    goto DO_STOP
if /i "%CMD%"=="restart" goto DO_RESTART
if /i "%CMD%"=="status"  goto DO_STATUS
echo Usage: start.bat [start / stop / restart / status]
exit /b 1

:DO_START
echo.
echo  Nemesis HA Console v1.0
echo  ========================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [INFO]  Node.js %%v

if not exist "%VITE_JS%" (
    echo [INFO]  Running npm install...
    pushd "%FRONTEND%"
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        popd
        pause
        exit /b 1
    )
    popd
    echo [OK]    Dependencies installed
)

call :CHECK_PORT %API_PORT%
if %errorlevel%==0 (
    echo [WARN]  Port %API_PORT% already in use. Use: start.bat stop
    goto OPEN_BROWSER
)

echo [1/2]  Starting Mock API on port %API_PORT%...
start "Nemesis-API" /B node "%ROOT%mock-api.js"
timeout /t 2 /nobreak >nul

call :CHECK_PORT %API_PORT%
if %errorlevel% neq 0 (
    echo [ERROR] Mock API failed to start.
    pause
    exit /b 1
)
echo [OK]    Mock API running on port %API_PORT%

call :CHECK_PORT %UI_PORT%
if %errorlevel%==0 (
    echo [WARN]  Port %UI_PORT% already in use.
    goto OPEN_BROWSER
)

echo [2/2]  Starting Vite UI on port %UI_PORT%...
pushd "%FRONTEND%"
start "Nemesis-UI" /B node "%VITE_JS%" --host
popd
timeout /t 5 /nobreak >nul

call :CHECK_PORT %UI_PORT%
if %errorlevel% neq 0 (
    echo [WARN]  Vite may still be initializing. Check the Nemesis-UI window.
) else (
    echo [OK]    Vite UI running on port %UI_PORT%
)

:OPEN_BROWSER
echo.
echo  ========================
echo  UI  : http://localhost:%UI_PORT%
echo  API : http://localhost:%API_PORT%
echo  Stop: start.bat stop
echo  ========================
echo.
start http://localhost:%UI_PORT%
exit /b 0

:DO_STOP
echo [INFO]  Stopping Nemesis servers...

for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%API_PORT% " ^| findstr LISTENING') do (
    echo [INFO]  Killing API PID %%a
    taskkill /PID %%a /F >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%UI_PORT% " ^| findstr LISTENING') do (
    echo [INFO]  Killing UI PID %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo [OK]    Stopped
exit /b 0

:DO_RESTART
call :DO_STOP_SUB
timeout /t 2 /nobreak >nul
goto DO_START

:DO_STATUS
echo.
echo  Nemesis HA Console -- Status
echo  --------------------------------

call :CHECK_PORT %API_PORT%
if %errorlevel%==0 (
    echo  Mock API  :  RUNNING   port=%API_PORT%
) else (
    echo  Mock API  :  STOPPED   port=%API_PORT%
)

call :CHECK_PORT %UI_PORT%
if %errorlevel%==0 (
    echo  Vite UI   :  RUNNING   port=%UI_PORT%
) else (
    echo  Vite UI   :  STOPPED   port=%UI_PORT%
)

echo  --------------------------------
echo.
exit /b 0

:CHECK_PORT
netstat -aon 2>nul | findstr ":%1 " | findstr /C:"LISTENING" >nul 2>&1
exit /b %errorlevel%

:DO_STOP_SUB
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%API_PORT% " ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%UI_PORT% " ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
exit /b 0
