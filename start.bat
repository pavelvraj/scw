@echo off
setlocal
cd /d "%~dp0"

set "VENV_PATH=C:\Temp\SCW"

if not exist "%VENV_PATH%\Scripts\python.exe" (
    echo Vytvarim Python prostredi v %VENV_PATH%...
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -m venv "%VENV_PATH%"
    ) else (
        python -m venv "%VENV_PATH%"
    )
    if errorlevel 1 (
        echo Nepodarilo se vytvorit virtualni prostredi. Nainstaluj Python 3.11 nebo novejsi.
        pause
        exit /b 1
    )
    echo Instaluji zavislosti...
    "%VENV_PATH%\Scripts\python.exe" -m pip install --upgrade pip
    "%VENV_PATH%\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Instalace zavislosti selhala.
        pause
        exit /b 1
    )
)

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8765'"
echo Stream Cinema bezi na http://127.0.0.1:8765
echo Ukonci aplikaci stisknutim Ctrl+C v tomto okne.
"%VENV_PATH%\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8765
