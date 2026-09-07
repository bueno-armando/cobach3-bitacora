@echo off
REM ==========================================================
REM  Script de arranque para Windows
REM  Sistema de Inventario - COBACH Plantel 3
REM ==========================================================

cd /d %~dp0

if not exist .venv (
    echo [INFO] Creando entorno virtual e instalando dependencias...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

if not exist inventario.db (
    echo [INFO] Inicializando base de datos...
    if exist "Inventario_060926.xls" (
        python scripts\migrate_excels.py
    ) else (
        python scripts\seed_sample_data.py
    )
)

echo ==========================================================
echo  Sistema de Inventario - COBACH Plantel 3
echo  Servidor disponible en: http://localhost:8000
echo  Documentacion Swagger:  http://localhost:8000/docs
echo ==========================================================

start http://localhost:8000
uvicorn backend.main:app --host 0.0.0.0 --port 8000

pause
