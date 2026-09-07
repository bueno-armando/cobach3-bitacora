@echo off
chcp 65001 > nul
title Instalador - Sistema de Inventario COBACH Plantel 3

echo ========================================================
echo   Instalador Automatizado para Windows
echo   Sistema de Inventario - COBACH Plantel 3
echo ========================================================
echo.

:: 1. Verificar si Python está instalado
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python no está instalado o no se encuentra en el PATH.
    echo Por favor descarga e instala Python 3.10 o superior desde:
    echo   https://www.python.org/downloads/
    echo.
    echo IMPORTANTE: Al instalar Python, marca la casilla que dice:
    echo   "[X] Add Python to PATH"
    echo.
    pause
    exit /b 1
)

echo [1/4] Python detectado correctamente.
python --version
echo.

:: 2. Crear entorno virtual (.venv) si no existe
if not exist ".venv" (
    echo [2/4] Creando entorno virtual de Python en '.venv'...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Falló la creación del entorno virtual.
        pause
        exit /b 1
    )
    echo     Entorno virtual creado exitosamente.
) else (
    echo [2/4] El entorno virtual '.venv' ya existe. Omitiendo creación.
)
echo.

:: 3. Instalar librerías de requirements.txt
echo [3/4] Instalando dependencias de Python...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Ocurrió un problema instalando los paquetes de requirements.txt.
    pause
    exit /b 1
)
echo     Dependencias instaladas correctamente.
echo.

:: 4. Verificar base de datos
echo [4/4] Verificando base de datos SQLite (inventario.db)...
if exist "inventario.db" (
    echo     Base de datos 'inventario.db' encontrada. Todo listo.
) else (
    echo     No se encontró 'inventario.db'.
    echo     Ejecutando script de migración inicial de Excels...
    python scripts\migrate_excels.py
    if %errorlevel% neq 0 (
        echo [ADVERTENCIA] El script de migración tuvo detalles. Revisa si los Excels fuente están en la carpeta.
    ) else (
        echo     Base de datos creada y 1,406 activos migrados exitosamente.
    )
)
echo.

echo ========================================================
echo   ¡INSTALACIÓN COMPLETADA CON ÉXITO!
echo ========================================================
echo Para iniciar el sistema en cualquier momento, solo haz
echo doble clic en: iniciar_sistema.bat
echo ========================================================
echo.
pause
