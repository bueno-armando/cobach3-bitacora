#!/usr/bin/env bash
# Script para iniciar el servidor de desarrollo en Linux (Arch Linux)
set -e

if [ ! -d ".venv" ]; then
    echo "Creando entorno virtual .venv..."
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
fi

if [ ! -f "inventario.db" ]; then
    echo "Base de datos no encontrada. Ejecutando migración inicial..."
    .venv/bin/python scripts/migrate_excels.py
fi

echo "=========================================================="
echo " Sistema de Inventario - COBACH Plantel 3"
echo " Servidor disponible en: http://localhost:8000"
echo " Documentación API en:   http://localhost:8000/docs"
echo "=========================================================="

.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
