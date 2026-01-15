param([string]\C:\AI\Configurateur,[string]\C:\AI\Configurateur\.venv\Scripts\Activate.ps1)

Set-Location -LiteralPath \C:\AI\Configurateur

if (Test-Path -LiteralPath \C:\AI\Configurateur\.venv\Scripts\Activate.ps1) {
  . \C:\AI\Configurateur\.venv\Scripts\Activate.ps1
} else {
  Write-Host "âš ï¸ Venv not found: \C:\AI\Configurateur\.venv\Scripts\Activate.ps1" -ForegroundColor Yellow
}

\ = \C:\AI\Configurateur
Write-Host "PYTHONPATH=\" -ForegroundColor DarkGray

python -m uvicorn backend.app:app --app-dir \C:\AI\Configurateur --host 127.0.0.1 --port 8000 --reload
