@echo off
chcp 65001 > nul
title Servidor - Inventario COBACH Plantel 3

:: Comprobar si existe el entorno virtual
if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] No se ha encontrado el entorno virtual '.venv'.
    echo Por favor ejecuta primero: instalar_windows.bat
    echo.
    pause
    exit /b 1
)

echo ========================================================
echo   Iniciando Sistema de Inventario - COBACH Plantel 3
echo ========================================================
echo   * Servidor local:  http://localhost:8000
echo   * Documentación:   http://localhost:8000/docs
echo   * Para detenerlo:  Cierra esta ventana o presiona Ctrl+C
echo ========================================================
echo.

:: Abrir automáticamente el navegador predeterminado después de 2 segundos
start "" cmd /c "timeout /t 2 /nobreak > nul && start http://localhost:8000"

:: Activar entorno virtual y arrancar servidor escuchando en todas las interfaces (LAN)
call .venv\Scripts\activate.bat
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

pause
