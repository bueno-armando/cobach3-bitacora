#!/usr/bin/env python3
"""
Script generador de datos sintéticos/ficticios para pruebas y demostración (CV / Portafolio).
Permite poblar 'inventario.db' con activos simulados sin exponer datos institucionales reales.
"""

import os
import sys
from datetime import date

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend.database import engine, SessionLocal, Base
from backend.models import Activo, Categoria, Ubicacion, Resguardante


def seed_sample_data():
    print("Inicializando base de datos de demostración con datos sintéticos...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    session = SessionLocal()

    # 1. Catálogos de muestra
    cat_comp = Categoria(nombre="EQUIPO DE CÓMPUTO")
    cat_aula = Categoria(nombre="EQUIPO DE AULAS")
    cat_audio = Categoria(nombre="EQUIPO AUDIOVISUAL")
    cat_ofic = Categoria(nombre="EQUIPO DE OFICINA")
    session.add_all([cat_comp, cat_aula, cat_audio, cat_ofic])
    session.flush()

    ubi_lab1 = Ubicacion(nombre="LABORATORIO DE CÓMPUTO 1")
    ubi_aula1 = Ubicacion(nombre="AULA 101")
    ubi_audio = Ubicacion(nombre="AUDITORIO PRINCIPAL")
    ubi_dir = Ubicacion(nombre="DIRECCIÓN")
    session.add_all([ubi_lab1, ubi_aula1, ubi_audio, ubi_dir])
    session.flush()

    res_1 = Resguardante(nombre="ING. CARLOS MENDOZA")
    res_2 = Resguardante(nombre="MTRA. LAURA FLORES")
    session.add_all([res_1, res_2])
    session.flush()

    # 2. Activos de muestra
    muestra_activos = [
        # Central (con etiqueta verde)
        Activo(
            codigo_interno="PL3-CEN-010001",
            codigo_oficial="10001",
            origen="CENTRAL",
            estatus_etiqueta="ETIQUETADO_OFICIAL",
            descripcion="COMPUTADORA DE ESCRITORIO",
            especificacion="INTEL CORE I5 12VA GEN, 16GB RAM, 512GB SSD",
            marca="HP",
            modelo="PRODESK 400 G9",
            numero_serie="MXL202301A",
            categoria_id=cat_comp.id,
            ubicacion_id=ubi_lab1.id,
            resguardante_id=res_1.id,
            condicion="Excelente 81% - 100%",
            archivo_fuente="demo_seed"
        ),
        Activo(
            codigo_interno="PL3-CEN-010002",
            codigo_oficial="10002",
            origen="CENTRAL",
            estatus_etiqueta="ETIQUETADO_OFICIAL",
            descripcion="PROYECTOR INTERACTIVO",
            especificacion="3600 LÚMENES WXGA",
            marca="EPSON",
            modelo="POWERLITE 982W",
            numero_serie="EPS982001",
            categoria_id=cat_audio.id,
            ubicacion_id=ubi_aula1.id,
            resguardante_id=res_2.id,
            condicion="Buena 61% - 80%",
            archivo_fuente="demo_seed"
        ),
        # Gasto (pendiente de etiqueta verde)
        Activo(
            codigo_interno="PL3-GTO-0001",
            codigo_oficial=None,
            origen="GASTO",
            estatus_etiqueta="PENDIENTE_ETIQUETA",
            descripcion="IMPRESORA MULTIFUNCIONAL LÁSER",
            especificacion="LÁSER MONOCROMÁTICA DOBLE CARA",
            marca="HP",
            modelo="LASERJET PRO MFP 4103FDW",
            numero_serie="VND7788990",
            categoria_id=cat_ofic.id,
            ubicacion_id=ubi_dir.id,
            resguardante_id=res_1.id,
            archivo_fuente="demo_seed"
        ),
        # C.A. (pendiente de etiqueta verde)
        Activo(
            codigo_interno="PL3-CA-0001",
            codigo_oficial=None,
            origen="C.A.",
            estatus_etiqueta="PENDIENTE_ETIQUETA",
            descripcion="PIZARRÓN BLANCO PORCELANIZADO",
            especificacion="120CM X 240CM MARCO DE ALUMINIO",
            marca="ALFRA",
            modelo="CLASSIC",
            numero_serie=None,
            categoria_id=cat_aula.id,
            ubicacion_id=ubi_aula1.id,
            resguardante_id=res_2.id,
            archivo_fuente="demo_seed"
        ),
        # Auditorio
        Activo(
            codigo_interno="PL3-AUD-024753",
            codigo_oficial="24753",
            origen="AUDITORIO",
            estatus_etiqueta="ETIQUETADO_OFICIAL",
            descripcion="BUTACA DE AUDITORIO",
            especificacion="TAPIZADA COLOR AZUL CON PALETA ABATIBLE",
            marca="EZCARAY",
            modelo="MINI-AUD",
            numero_serie=None,
            categoria_id=cat_audio.id,
            ubicacion_id=ubi_audio.id,
            resguardante_id=res_1.id,
            archivo_fuente="demo_seed"
        ),
    ]

    session.add_all(muestra_activos)
    session.commit()
    session.close()

    print("Base de datos poblada con éxito con activos de prueba para demostración.")


if __name__ == "__main__":
    seed_sample_data()
