# C:\AI\Configurateur\scripts\start_dev.ps1
$ErrorActionPreference = "Stop"

$ROOT  = "C:\AI\Configurateur"
$FRONT = Join-Path $ROOT "frontend"

Write-Host "=== START DEV (backend + vite) ===" -ForegroundColor Cyan

# --- Backend ---
Start-Process powershell -WorkingDirectory $ROOT -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy","Bypass",
  "-Command",
  "python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload"
) | Out-Null

Write-Host "Backend: http://127.0.0.1:8000" -ForegroundColor Green

# --- Frontend (Vite) ---
Start-Process powershell -WorkingDirectory $FRONT -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy","Bypass",
  "-Command",
  "npm run dev -- --host 127.0.0.1 --port 5173"
) | Out-Null

Write-Host "Vite: http://127.0.0.1:5173" -ForegroundColor Green

Start-Sleep -Milliseconds 500
Start-Process "http://127.0.0.1:5173" | Out-Null
