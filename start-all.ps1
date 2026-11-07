<#
.SYNOPSIS
    Health-On (MedBrief) Multi-Service Launcher for Windows PowerShell.
.DESCRIPTION
    Starts the Backend Node.js API, React Doctor Dashboard, Whisper STT,
    and PaddleOCR services in organized background jobs or windows.
.EXAMPLE
    .\start-all.ps1
    .\start-all.ps1 -CoreOnly
    .\start-all.ps1 -Status
    .\start-all.ps1 -Stop
#>

[CmdletBinding()]
param (
    [switch]$CoreOnly,
    [switch]$Status,
    [switch]$Stop
)

$rootDir = $PSScriptRoot
Set-Location $rootDir

$ports = @{
    "Public Node API" = 4000
    "React Client"    = 5173
    "Whisper STT"     = 8001
    "PaddleOCR"       = 8000
    "Identity Service" = 4101
    "Safety Service"  = 4102
}

function Test-PortListening ($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

function Stop-Services {
    Write-Host "`nStopping Health-On services on known ports..." -ForegroundColor Yellow
    foreach ($entry in $ports.GetEnumerator()) {
        $port = $entry.Value
        $name = $entry.Key
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            $pidsToKill = $conns | Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($p in $pidsToKill) {
                Write-Host "  Stopping $name (Port $port, PID $p)..." -ForegroundColor Cyan
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Write-Host "Services stopped.`n" -ForegroundColor Green
}

function Show-Status {
    Write-Host "`n=== Health-On Service Status ===" -ForegroundColor Cyan
    Write-Host ("{0,-30} {1,-8} {2,-12}" -f "SERVICE", "PORT", "STATE")
    Write-Host ("{0,-30} {1,-8} {2,-12}" -f "-------", "----", "-----")
    foreach ($entry in $ports.GetEnumerator()) {
        $isListening = Test-PortListening $entry.Value
        $state = if ($isListening) { "RUNNING" } else { "STOPPED" }
        $color = if ($isListening) { "Green" } else { "DarkGray" }
        Write-Host ("{0,-30} {1,-8} {2,-12}" -f $entry.Key, $entry.Value, $state) -ForegroundColor $color
    }
    Write-Host ""
}

if ($Stop) {
    Stop-Services
    exit 0
}

if ($Status) {
    Show-Status
    exit 0
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "          Health-On (MedBrief) Launcher for Windows             " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path (Join-Path $rootDir "server\.env"))) {
    Write-Host "[!] server\.env not found. Running setup.ps1 first..." -ForegroundColor Yellow
    & (Join-Path $rootDir "setup.ps1")
}

# 1. Start Backend API
if (Test-PortListening 4000) {
    Write-Host "  [✓] Backend API already running on port 4000" -ForegroundColor Green
} else {
    Write-Host "  --> Starting Backend API on http://localhost:4000 ..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir\server'; Write-Host '--- Health-On Backend API (Port 4000) ---' -ForegroundColor Cyan; npm run dev"
}

# 2. Start React Web Client
if (Test-PortListening 5173) {
    Write-Host "  [✓] React Client already running on port 5173" -ForegroundColor Green
} else {
    Write-Host "  --> Starting React Doctor Dashboard on http://localhost:5173 ..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir\client'; Write-Host '--- Health-On Clinician Portal (Port 5173) ---' -ForegroundColor Green; npm run dev"
}

# 3. Start Whisper STT (if not CoreOnly)
if (-not $CoreOnly) {
    $whisperExe = Join-Path $rootDir "whisper-service\venv\Scripts\python.exe"
    if (Test-Path $whisperExe) {
        if (Test-PortListening 8001) {
            Write-Host "  [✓] Whisper STT already running on port 8001" -ForegroundColor Green
        } else {
            Write-Host "  --> Starting Whisper STT on http://localhost:8001 ..." -ForegroundColor Cyan
            Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir\whisper-service'; Write-Host '--- Whisper STT (Port 8001) ---' -ForegroundColor Magenta; .\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001"
        }
    }

    # 4. Start PaddleOCR
    $ocrExe = Join-Path $rootDir "PaddleOCRFastAPI\venv\Scripts\python.exe"
    if (Test-Path $ocrExe) {
        if (Test-PortListening 8000) {
            Write-Host "  [✓] PaddleOCR already running on port 8000" -ForegroundColor Green
        } else {
            Write-Host "  --> Starting PaddleOCR on http://localhost:8000 ..." -ForegroundColor Cyan
            Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir\PaddleOCRFastAPI'; Write-Host '--- PaddleOCR (Port 8000) ---' -ForegroundColor Yellow; .\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
        }
    }
}

Start-Sleep -Seconds 2
Show-Status

Write-Host "All requested services have been started in separate terminal windows." -ForegroundColor Green
Write-Host "  - Clinician Portal:  http://localhost:5173" -ForegroundColor Cyan
Write-Host "  - Backend REST API:  http://localhost:4000" -ForegroundColor Cyan
Write-Host "  - API Health:        http://localhost:4000/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tip: Run '.\start-all.ps1 -Stop' to terminate active services." -ForegroundColor DarkGray
Write-Host ""
