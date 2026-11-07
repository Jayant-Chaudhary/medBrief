@echo off
rem ==============================================================================
rem Health-On (MedBrief) Automated Setup Script for Windows (Batch / CMD)
rem
rem Configures environment files, installs Node.js & Python dependencies,
rem sets up virtual environments, and prepares the workspace for execution.
rem ==============================================================================

setlocal enabledelayedexpansion

echo ================================================================
echo       Health-On (MedBrief) Automated Setup for Windows
echo ================================================================
echo.

rem ------------------------------------------------------------------------------
rem 1. Check Prerequisites
rem ------------------------------------------------------------------------------
echo [1/6] Checking system prerequisites...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH.
    echo Please install Node.js 20+ (recommended v24) from https://nodejs.org/
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   [OK] Node.js !NODE_VER! found.

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm is not found in PATH.
    exit /b 1
)
for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo   [OK] npm !NPM_VER! found.

where git >nul 2>nul
if %errorlevel% equ 0 (
    echo   [OK] Git found.
) else (
    echo   [WARN] Git not found in PATH.
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PY_VER=%%i
    echo   [OK] Python !PY_VER! found.
    set HAS_PYTHON=1
) else (
    echo   [WARN] Python not found in PATH. Microservices (OCR/Whisper) will be skipped.
    set HAS_PYTHON=0
)

where flutter >nul 2>nul
if %errorlevel% equ 0 (
    echo   [OK] Flutter SDK found.
    set HAS_FLUTTER=1
) else (
    echo   [INFO] Flutter not found (optional, only needed for mobile app development).
    set HAS_FLUTTER=0
)

where docker >nul 2>nul
if %errorlevel% equ 0 (
    echo   [OK] Docker found.
) else (
    echo   [INFO] Docker not found (optional, for Redis cache and containerized OCR).
)

echo.
rem ------------------------------------------------------------------------------
rem 2. Configure Environment Files (.env)
rem ------------------------------------------------------------------------------
echo [2/6] Configuring environment configuration files...

if not exist "server\.env" (
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo   [OK] Created server\.env from template.
    )
) else (
    echo   [INFO] server\.env already exists (preserved).
)

if not exist "client\.env" (
    if exist "client\.env.example" (
        copy "client\.env.example" "client\.env" >nul
        echo   [OK] Created client\.env from template.
    )
) else (
    echo   [INFO] client\.env already exists (preserved).
)

if not exist "mobile\config.json" (
    if exist "mobile\config.example.json" (
        copy "mobile\config.example.json" "mobile\config.json" >nul
        echo   [OK] Created mobile\config.json from template.
    )
) else (
    echo   [INFO] mobile\config.json already exists (preserved).
)

echo.
rem ------------------------------------------------------------------------------
rem 3. Install Node.js Backend & Frontend Packages
rem ------------------------------------------------------------------------------
echo [3/6] Installing Node.js dependencies...

echo   --> Installing server dependencies (server\)...
cd server
call npm install --no-audit --prefer-offline
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install server dependencies.
    cd ..
    exit /b 1
)
cd ..
echo   [OK] Server dependencies installed.

echo   --> Installing client dependencies (client\)...
cd client
call npm install --no-audit --prefer-offline
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install client dependencies.
    cd ..
    exit /b 1
)
cd ..
echo   [OK] Client dependencies installed.

echo.
rem ------------------------------------------------------------------------------
rem 4. Generate Storage Envelope Encryption Keys
rem ------------------------------------------------------------------------------
echo [4/6] Checking storage encryption keypair...
findstr /C:"STORAGE_ENCRYPTION_RSA_PUBLIC_KEY=" server\.env >nul 2>&1
if %errorlevel% neq 0 (
    echo   --> Generating 2048-bit RSA keypair for storage envelope encryption...
    node server\scripts\generateEncryptionKeys.js --bits 2048 > "%TEMP%\keys.tmp" 2>&1
    for /f "tokens=*" %%a in ('findstr /C:"STORAGE_ENCRYPTION_RSA_PUBLIC_KEY=" "%TEMP%\keys.tmp"') do (
        echo %%a >> server\.env
    )
    for /f "tokens=*" %%b in ('findstr /C:"STORAGE_ENCRYPTION_RSA_PRIVATE_KEY=" "%TEMP%\keys.tmp"') do (
        echo %%b >> server\.env
    )
    if exist "%TEMP%\keys.tmp" del "%TEMP%\keys.tmp"
    echo   [OK] Storage encryption keys generated and added to server\.env.
) else (
    echo   [OK] Storage encryption keys already present in server\.env.
)

echo.
rem ------------------------------------------------------------------------------
rem 5. Setup Python Microservices (OCR and Whisper)
rem ------------------------------------------------------------------------------
echo [5/6] Setting up Python microservices...

if "!HAS_PYTHON!"=="1" (
    rem PaddleOCR Virtual Environment
    if exist "PaddleOCRFastAPI" (
        echo   --> Setting up PaddleOCR virtual environment...
        cd PaddleOCRFastAPI
        if not exist "venv" (
            python -m venv venv
            call venv\Scripts\activate.bat
            python -m pip install --upgrade pip >nul 2>&1
            if exist "requirements.txt" (
                echo       Installing PaddleOCR dependencies (this may take a few minutes)...
                pip install -r requirements.txt
            )
            call venv\Scripts\deactivate.bat
            echo   [OK] PaddleOCR virtual environment configured.
        ) else (
            echo   [INFO] PaddleOCR venv already exists.
        )
        cd ..
    )

    rem Faster-Whisper STT Virtual Environment
    if exist "whisper-service" (
        echo   --> Setting up Whisper STT virtual environment...
        cd whisper-service
        if not exist "venv" (
            python -m venv venv
            call venv\Scripts\activate.bat
            python -m pip install --upgrade pip >nul 2>&1
            if exist "requirements.txt" (
                echo       Installing Whisper STT dependencies...
                pip install -r requirements.txt
            )
            call venv\Scripts\deactivate.bat
            echo   [OK] Whisper STT virtual environment configured.
        ) else (
            echo   [INFO] Whisper STT venv already exists.
        )
        cd ..
    )
) else (
    echo   [INFO] Skipping Python microservices (Python not installed).
)

rem Mobile Flutter Packages
if "!HAS_FLUTTER!"=="1" (
    if exist "mobile" (
        echo.
        echo   --> Fetching Flutter mobile dependencies...
        cd mobile
        call flutter pub get
        cd ..
        echo   [OK] Flutter packages installed.
    )
)

echo.
rem ------------------------------------------------------------------------------
rem 6. Completion Summary
rem ------------------------------------------------------------------------------
echo ================================================================
echo                Setup Completed Successfully!
echo ================================================================
echo.
echo Next Steps:
echo 1. Open "server\.env" and fill in your Supabase credentials:
echo      - SUPABASE_URL
echo      - SUPABASE_ANON_KEY
echo      - SUPABASE_SERVICE_ROLE_KEY
echo      - GEMINI_API_KEY (optional, fallback engine active)
echo.
echo 2. Apply database migrations from "supabase\migrations\" in Supabase SQL Editor.
echo.
echo 3. Start all services using:
echo      start-all.bat
echo    (or in PowerShell: .\start-all.ps1)
echo.
echo Access URLs:
echo   - Clinician Dashboard:  http://localhost:5173
echo   - Backend REST API:     http://localhost:4000
echo   - OCR Microservice:     http://localhost:8000/docs
echo   - Whisper STT:          http://localhost:8001/health
echo.
pause
