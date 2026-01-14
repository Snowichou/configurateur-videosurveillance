# C:\AI\Configurateur\scripts\start_dev.ps1
$ErrorActionPreference = "Stop"

$ROOT = "C:\AI\Configurateur"
$VENV = Join-Path $ROOT ".venv\Scripts\Activate.ps1"
$FRONT = Join-Path $ROOT "frontend"

Write-Host "=== START DEV (backend + vite) ===" -ForegroundColor Cyan

# --- Backend (FastAPI / Uvicorn) ---
$backendCmd = @"
cd /d `"$ROOT`"
if (Test-Path `"$VENV`") { . `"$VENV`" } else { Write-Host '⚠️ Venv not found' }
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd | Out-Null
Write-Host "Backend lancé: http://127.0.0.1:8000" -ForegroundColor Green

# --- Frontend (Vite) ---
$viteCmd = @"
cd /d `"$FRONT`"
npm run dev -- --host 127.0.0.1 --port 5173
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $viteCmd | Out-Null
Write-Host "Vite lancé: http://127.0.0.1:5173" -ForegroundColor Green

# Optionnel: ouvrir les pages
Start-Sleep -Milliseconds 500
Start-Process "http://127.0.0.1:5173" | Out-Null
