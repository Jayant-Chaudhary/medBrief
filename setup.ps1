<#
.SYNOPSIS
    Health-On (MedBrief) Automated Setup Script for Windows PowerShell.
.DESCRIPTION
    Checks system prerequisites, initializes .env files from templates,
    installs Node.js & Python dependencies, creates virtual environments,
    and prepares the workspace to run all services.
.EXAMPLE
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    .\setup.ps1
#>

[CmdletBinding()]
param (
    [switch]$CoreOnly,
    [switch]$SkipPython,
    [switch]$SkipFlutter
)

$ErrorActionPreference = "Stop"
$rootDir = $PSScriptRoot
Set-Location $rootDir

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "      Health-On (MedBrief) Automated Setup for Windows          " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------------------------
# 1. Prerequisite Checks
# ------------------------------------------------------------------------------
Write-Host "[1/6] Checking system prerequisites..." -ForegroundColor Yellow

# Node.js
$nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js 20+ (recommended: v24 LTS) from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
$nodeVersion = (node -v).Trim()
Write-Host "  [✓] Node.js $nodeVersion detected ($($nodeCmd.Source))" -ForegroundColor Green

# npm
$npmCmd = Get-Command "npm" -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Write-Host "[ERROR] npm is not found in PATH." -ForegroundColor Red
    exit 1
}
$npmVersion = (npm -v).Trim()
Write-Host "  [✓] npm v$npmVersion detected" -ForegroundColor Green

# Git
$gitCmd = Get-Command "git" -ErrorAction SilentlyContinue
if ($gitCmd) {
    Write-Host "  [✓] Git detected" -ForegroundColor Green
} else {
    Write-Host "  [!] Git not found in PATH." -ForegroundColor Yellow
}

# Python
$pythonCmd = Get-Command "python" -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command "python3" -ErrorAction SilentlyContinue
}
if ($pythonCmd -and (-not $SkipPython)) {
    $pyVersion = (& $pythonCmd.Name --version 2>&1).ToString().Trim()
    Write-Host "  [✓] Python $pyVersion detected" -ForegroundColor Green
    $hasPython = $true
} else {
    Write-Host "  [!] Python not found or skipped. OCR and Whisper local services will be bypassed." -ForegroundColor Yellow
    $hasPython = $false
}

# Flutter
$flutterCmd = Get-Command "flutter" -ErrorAction SilentlyContinue
if ($flutterCmd -and (-not $SkipFlutter)) {
    Write-Host "  [✓] Flutter SDK detected" -ForegroundColor Green
    $hasFlutter = $true
} else {
    Write-Host "  [i] Flutter not found (optional, only needed for mobile app development)" -ForegroundColor DarkGray
    $hasFlutter = $false
}

# Docker
$dockerCmd = Get-Command "docker" -ErrorAction SilentlyContinue
if ($dockerCmd) {
    Write-Host "  [✓] Docker detected" -ForegroundColor Green
} else {
    Write-Host "  [i] Docker not found (optional, for Redis cache and containerized OCR)" -ForegroundColor DarkGray
}

Write-Host ""

# ------------------------------------------------------------------------------
# 2. Configure Environment Files (.env)
# ------------------------------------------------------------------------------
Write-Host "[2/6] Configuring environment configuration files..." -ForegroundColor Yellow

# server/.env
$serverEnv = Join-Path $rootDir "server\.env"
$serverEnvExample = Join-Path $rootDir "server\.env.example"
if (-not (Test-Path $serverEnv)) {
    if (Test-Path $serverEnvExample) {
        Copy-Item $serverEnvExample $serverEnv
        Write-Host "  [✓] Created server\.env from template" -ForegroundColor Green
    }
} else {
    Write-Host "  [i] server\.env already exists (preserved)" -ForegroundColor DarkGray
}

# client/.env
$clientEnv = Join-Path $rootDir "client\.env"
$clientEnvExample = Join-Path $rootDir "client\.env.example"
if (-not (Test-Path $clientEnv)) {
    if (Test-Path $clientEnvExample) {
        Copy-Item $clientEnvExample $clientEnv
        Write-Host "  [✓] Created client\.env from template" -ForegroundColor Green
    }
} else {
    Write-Host "  [i] client\.env already exists (preserved)" -ForegroundColor DarkGray
}

# mobile/config.json
$mobileConfig = Join-Path $rootDir "mobile\config.json"
$mobileConfigExample = Join-Path $rootDir "mobile\config.example.json"
if (-not (Test-Path $mobileConfig)) {
    if (Test-Path $mobileConfigExample) {
        Copy-Item $mobileConfigExample $mobileConfig
        Write-Host "  [✓] Created mobile\config.json from template" -ForegroundColor Green
    }
} else {
    Write-Host "  [i] mobile\config.json already exists (preserved)" -ForegroundColor DarkGray
}

Write-Host ""

# ------------------------------------------------------------------------------
# 3. Install Node.js Backend & Frontend Packages
# ------------------------------------------------------------------------------
Write-Host "[3/6] Installing Node.js dependencies..." -ForegroundColor Yellow

Write-Host "  --> Installing server dependencies (server\)..." -ForegroundColor Cyan
Push-Location (Join-Path $rootDir "server")
try {
    & npm install --no-audit --prefer-offline
    Write-Host "  [✓] Server dependencies installed" -ForegroundColor Green
} finally {
    Pop-Location
}

Write-Host "  --> Installing client dependencies (client\)..." -ForegroundColor Cyan
Push-Location (Join-Path $rootDir "client")
try {
    & npm install --no-audit --prefer-offline
    Write-Host "  [✓] Client dependencies installed" -ForegroundColor Green
} finally {
    Pop-Location
}

Write-Host ""

# ------------------------------------------------------------------------------
# 4. Generate Storage Envelope Encryption Keys
# ------------------------------------------------------------------------------
Write-Host "[4/6] Checking storage encryption keypair..." -ForegroundColor Yellow
$serverEnvContent = Get-Content $serverEnv -Raw
if ($serverEnvContent -notmatch "STORAGE_ENCRYPTION_RSA_PUBLIC_KEY=\S+") {
    Write-Host "  --> Generating 2048-bit RSA keypair for storage envelope encryption..." -ForegroundColor Cyan
    $keyGenScript = Join-Path $rootDir "server\scripts\generateEncryptionKeys.js"
    $keyOutput = & node $keyGenScript --bits 2048 2>&1
    $pubKeyMatch = [regex]::Match($keyOutput, 'STORAGE_ENCRYPTION_RSA_PUBLIC_KEY="([^"]+)"')
    $privKeyMatch = [regex]::Match($keyOutput, 'STORAGE_ENCRYPTION_RSA_PRIVATE_KEY="([^"]+)"')

    if ($pubKeyMatch.Success -and $privKeyMatch.Success) {
        $pubKey = $pubKeyMatch.Groups[1].Value
        $privKey = $privKeyMatch.Groups[1].Value

        Add-Content -Path $serverEnv -Value "`nSTORAGE_ENCRYPTION_KEY_ID=`"v1`""
        Add-Content -Path $serverEnv -Value "STORAGE_ENCRYPTION_RSA_PUBLIC_KEY=`"$pubKey`""
        Add-Content -Path $serverEnv -Value "STORAGE_ENCRYPTION_RSA_PRIVATE_KEY=`"$privKey`""
        Write-Host "  [✓] Generated and saved storage encryption keys to server\.env" -ForegroundColor Green
    }
} else {
    Write-Host "  [✓] Storage encryption keys already present in server\.env" -ForegroundColor Green
}

Write-Host ""

# ------------------------------------------------------------------------------
# 5. Setup Python Microservices (PaddleOCR & Faster-Whisper)
# ------------------------------------------------------------------------------
Write-Host "[5/6] Setting up Python microservices..." -ForegroundColor Yellow

if ($hasPython -and (-not $CoreOnly)) {
    # PaddleOCR
    $ocrDir = Join-Path $rootDir "PaddleOCRFastAPI"
    if (Test-Path $ocrDir) {
        Write-Host "  --> Setting up PaddleOCR virtual environment..." -ForegroundColor Cyan
        $ocrVenv = Join-Path $ocrDir "venv"
        if (-not (Test-Path $ocrVenv)) {
            & python -m venv $ocrVenv
            $ocrPip = Join-Path $ocrVenv "Scripts\pip.exe"
            & $ocrPip install --upgrade pip
            $ocrReqs = Join-Path $ocrDir "requirements.txt"
            if (Test-Path $ocrReqs) {
                Write-Host "      Installing PaddleOCR packages (this may take a few minutes)..."
                & $ocrPip install -r $ocrReqs
            }
            Write-Host "  [✓] PaddleOCR virtual environment configured" -ForegroundColor Green
        } else {
            Write-Host "  [i] PaddleOCR virtual environment already exists" -ForegroundColor DarkGray
        }
    }

    # Whisper STT
    $whisperDir = Join-Path $rootDir "whisper-service"
    if (Test-Path $whisperDir) {
        Write-Host "  --> Setting up Whisper STT virtual environment..." -ForegroundColor Cyan
        $whisperVenv = Join-Path $whisperDir "venv"
        if (-not (Test-Path $whisperVenv)) {
            & python -m venv $whisperVenv
            $whisperPip = Join-Path $whisperVenv "Scripts\pip.exe"
            & $whisperPip install --upgrade pip
            $whisperReqs = Join-Path $whisperDir "requirements.txt"
            if (Test-Path $whisperReqs) {
                Write-Host "      Installing Whisper STT packages..."
                & $whisperPip install -r $whisperReqs
            }
            Write-Host "  [✓] Whisper STT virtual environment configured" -ForegroundColor Green
        } else {
            Write-Host "  [i] Whisper STT virtual environment already exists" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  [i] Python setup skipped." -ForegroundColor DarkGray
}

# Flutter Mobile packages
if ($hasFlutter -and (-not $CoreOnly)) {
    $mobileDir = Join-Path $rootDir "mobile"
    if (Test-Path $mobileDir) {
        Write-Host "  --> Fetching Flutter mobile dependencies..." -ForegroundColor Cyan
        Push-Location $mobileDir
        try {
            & flutter pub get
            Write-Host "  [✓] Flutter packages retrieved" -ForegroundColor Green
        } finally {
            Pop-Location
        }
    }
}

Write-Host ""

# ------------------------------------------------------------------------------
# 6. Completion Summary
# ------------------------------------------------------------------------------
Write-Host "================================================================" -ForegroundColor Green
Write-Host "                   Setup Completed Successfully!                " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Open server\.env and configure your Supabase & Gemini keys:"
Write-Host "       - SUPABASE_URL"
Write-Host "       - SUPABASE_ANON_KEY"
Write-Host "       - SUPABASE_SERVICE_ROLE_KEY"
Write-Host "       - GEMINI_API_KEY (optional, fallback rules active)"
Write-Host ""
Write-Host "  2. Apply database migrations in supabase\migrations\ in Supabase SQL Editor."
Write-Host ""
Write-Host "  3. Start all services using either:"
Write-Host "       .\start-all.ps1      (PowerShell)" -ForegroundColor Cyan
Write-Host "       start-all.bat        (Command Prompt)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Access URLs:" -ForegroundColor Yellow
Write-Host "  - Clinician Dashboard:  http://localhost:5173"
Write-Host "  - Backend REST API:     http://localhost:4000"
Write-Host "  - OCR Microservice:     http://localhost:8000/docs"
Write-Host "  - Whisper STT:          http://localhost:8001/health"
Write-Host ""
