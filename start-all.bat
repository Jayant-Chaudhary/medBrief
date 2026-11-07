@echo off
rem ==============================================================================
rem Health-On (MedBrief) Multi-Service Launcher for Windows (Command Prompt)
rem
rem Launches Backend API, React Web Client, and Microservices in separate windows.
rem ==============================================================================

setlocal enabledelayedexpansion

echo ================================================================
echo          Health-On (MedBrief) Launcher for Windows
echo ================================================================
echo.

set ROOT_DIR=%~dp0
cd /d "%ROOT_DIR%"

rem 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH. Please run setup.bat first.
    pause
    exit /b 1
)

rem 2. Check if server\.env exists
if not exist "server\.env" (
    echo [WARNING] server\.env not found. Running setup.bat first...
    call setup.bat
)

echo Starting Health-On services in dedicated windows...
echo.

rem 3. Start Backend API (Port 4000)
echo   [1/4] Starting Public Node API on http://localhost:4000 ...
start "HealthOn-Backend (Port 4000)" cmd /k "cd /d %ROOT_DIR%server && npm run dev"

rem 4. Start React Clinician Portal (Port 5173)
echo   [2/4] Starting React Doctor Dashboard on http://localhost:5173 ...
start "HealthOn-Client (Port 5173)" cmd /k "cd /d %ROOT_DIR%client && npm run dev"

rem 5. Start Whisper STT (Port 8001) if virtual environment exists
if exist "whisper-service\venv\Scripts\python.exe" (
    echo   [3/4] Starting Whisper STT on http://localhost:8001 ...
    start "HealthOn-Whisper (Port 8001)" cmd /k "cd /d %ROOT_DIR%whisper-service && venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001"
) else (
    echo   [3/4] Whisper STT skipped (venv not found). Run setup.bat to configure.
)

rem 6. Start PaddleOCR (Port 8000) if virtual environment exists
if exist "PaddleOCRFastAPI\venv\Scripts\python.exe" (
    echo   [4/4] Starting PaddleOCR on http://localhost:8000 ...
    start "HealthOn-PaddleOCR (Port 8000)" cmd /k "cd /d %ROOT_DIR%PaddleOCRFastAPI && venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
) else (
    echo   [4/4] PaddleOCR skipped (venv not found).
)

echo.
echo ================================================================
echo Services have been launched in separate terminal windows!
echo   - Clinician Portal:  http://localhost:5173
echo   - Backend REST API:  http://localhost:4000
echo   - API Health Check:  http://localhost:4000/health
echo ================================================================
echo.
echo (To stop services, simply close their respective console windows).
echo.
pause
