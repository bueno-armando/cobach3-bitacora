#!/usr/bin/env python3
"""
Script ETL de migración para el inventario del COBACH Plantel 3.
Lee los 4 archivos de origen:
  1. Inventario_060926.xls (Oficial Central, 1124 filas, con código de etiqueta verde)
  2. GTO PL 3.xlsx (Gasto, 126 filas, pendientes de etiqueta verde)
  3. C.A. PL 3.xlsx (C.A., 56 filas, pendientes de etiqueta verde)
  4. ARCHIVO PL3 SISTEMA.xlsx (Auditorio, 100 filas, con códigos existentes)

Unifica todo en una base de datos SQLite relacional normalizada.
"""

import os
import sys
import re
from datetime import datetime
import pandas as pd

# Asegurar que el directorio raíz del proyecto esté en el PYTHONPATH
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend.database import engine, SessionLocal, Base
from backend.models import Activo, Categoria, Ubicacion, Resguardante, HistorialEtiqueta


def clean_str(val):
    """Limpia cadenas, elimina espacios redundantes y convierte valores vacíos/'N/A' en None."""
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip()
    s = re.sub(r"\s+", " ", s)
    if s.upper() in {"N/A", "NA", "S/N", "SIN SERIE", "NO TIENE", "NO APLICA", "--", "NONE", "NAN", ""}:
        return None
    return s


def clean_float(val):
    """Convierte un valor a float o retorna None si no es válido."""
    if pd.isna(val) or val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def clean_date(val):
    """Parsea fechas en formatos variados (DD/MM/YYYY o YYYY-MM-DD)."""
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def normalize_categoria(cat_raw):
    """Normaliza nombres de categorías para evitar duplicados por tildes o abreviaturas."""
    cat = clean_str(cat_raw)
    if not cat:
        return None
    cat_up = cat.upper()
    if cat_up in {"EQUIPO DE MUSICA", "EQUIPO DE MÚSICA"}:
        return "EQUIPO DE MÚSICA"
    if ("HERR" in cat_up and "MTTO" in cat_up) or ("HERR" in cat_up and "MANTENIMIENTO" in cat_up):
        return "HERRAMIENTAS Y EQUIPO DE MANTENIMIENTO"
    return cat


def normalize_resguardante(res_raw):
    """Normaliza nombres de resguardantes (por ejemplo acentos en Dr. Álvarez)."""
    res = clean_str(res_raw)
    if not res:
        return None
    res_up = res.upper()
    if "EDGAR" in res_up and "ALVAREZ" in res_up:
        return "DR. EDGAR ÁLVAREZ CASTILLO"
    return res


def normalize_ubicacion(ubi_raw):
    """Limpia y normaliza ubicaciones."""
    ubi = clean_str(ubi_raw)
    if not ubi:
        return None
    return ubi


def get_or_create(session, model, cache, name):
    """Obtiene un registro de catálogo por nombre o lo crea si no existe (usando caché)."""
    if not name:
        return None
    if name in cache:
        return cache[name]
    
    obj = session.query(model).filter(model.nombre == name).first()
    if not obj:
        obj = model(nombre=name)
        session.add(obj)
        session.flush()
    
    cache[name] = obj.id
    return obj.id


def run_migration():
    print("==========================================================")
    print("Iniciando migración ETL de archivos Excel a SQLite...")
    print("==========================================================")

    # 1. Recrear tablas
    print("Creando esquema de base de datos relacional...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    session = SessionLocal()

    cat_cache = {}
    ubi_cache = {}
    res_cache = {}

    total_creados = 0
    conteo_origen = {"CENTRAL": 0, "GASTO": 0, "C.A.": 0, "AUDITORIO": 0}
    conteo_etiqueta = {"ETIQUETADO_OFICIAL": 0, "PENDIENTE_ETIQUETA": 0}

    # -------------------------------------------------------------
    # 2. Procesar Inventario_060926.xls (Oficina Central)
    # -------------------------------------------------------------
    inv_path = os.path.join(BASE_DIR, "Inventario_060926.xls")
    if os.path.exists(inv_path):
        print(f"\n[1/4] Procesando exportación central: {os.path.basename(inv_path)}...")
        df_inv = pd.read_html(inv_path)[0]
        print(f"      Filas encontradas: {len(df_inv)}")

        for idx, row in df_inv.iterrows():
            cod_num = int(row["Código"])
            cod_oficial = str(cod_num)
            cod_interno = f"PL3-CEN-{cod_num:06d}"

            cat_id = get_or_create(session, Categoria, cat_cache, normalize_categoria(row.get("Categoría")))
            ubi_id = get_or_create(session, Ubicacion, ubi_cache, normalize_ubicacion(row.get("Ubicación fisica")))
            res_id = get_or_create(session, Resguardante, res_cache, normalize_resguardante(row.get("Resguardante")))

            estatus_activo = "BAJA" if "BAJA" in str(row.get("Estatus", "")).upper() else "ACTIVO"

            activo = Activo(
                codigo_interno=cod_interno,
                codigo_oficial=cod_oficial,
                origen="CENTRAL",
                estatus_etiqueta="ETIQUETADO_OFICIAL",
                estatus_activo=estatus_activo,
                descripcion=clean_str(row.get("Descripción")) or "SIN DESCRIPCIÓN",
                especificacion=clean_str(row.get("Especificación")),
                marca=clean_str(row.get("Marca")),
                modelo=clean_str(row.get("Modelo")),
                numero_serie=clean_str(row.get("Número de serie")),
                categoria_id=cat_id,
                ubicacion_id=ubi_id,
                resguardante_id=res_id,
                familia=clean_str(row.get("Familia")),
                centro_costo=clean_str(row.get("Centro de costo")) or "PLANTEL 3",
                condicion=clean_str(row.get("Condición")),
                costo=clean_float(row.get("Costo")),
                donacion_tipo=clean_str(row.get("Donación")),
                orden_compra=clean_str(row.get("Orden de compra")),
                numero_factura=clean_str(row.get("No. de Factura")),
                fecha_recepcion=clean_date(row.get("Fecha de recepción")),
                observaciones=clean_str(row.get("Observaciones")),
                archivo_fuente="Inventario_060926.xls"
            )
            session.add(activo)
            total_creados += 1
            conteo_origen["CENTRAL"] += 1
            conteo_etiqueta["ETIQUETADO_OFICIAL"] += 1

        session.flush()
        print(f"      -> {len(df_inv)} activos de Oficina Central importados.")
    else:
        print(f"ADVERTENCIA: No se encontró {inv_path}")

    # -------------------------------------------------------------
    # 3. Procesar GTO PL 3.xlsx (Gasto)
    # -------------------------------------------------------------
    gto_path = os.path.join(BASE_DIR, "GTO PL 3.xlsx")
    if os.path.exists(gto_path):
        print(f"\n[2/4] Procesando archivo de Gasto: {os.path.basename(gto_path)}...")
        df_gto = pd.read_excel(gto_path)
        print(f"      Filas encontradas: {len(df_gto)}")

        for idx, row in df_gto.iterrows():
            cod_interno = f"PL3-GTO-{idx+1:04d}"

            cat_id = get_or_create(session, Categoria, cat_cache, normalize_categoria(row.get("Categoría")))
            ubi_id = get_or_create(session, Ubicacion, ubi_cache, normalize_ubicacion(row.get("Ubicación Física")))
            res_id = get_or_create(session, Resguardante, res_cache, normalize_resguardante(row.get("Resguardante")))

            activo = Activo(
                codigo_interno=cod_interno,
                codigo_oficial=None,  # Pendiente de etiqueta verde
                origen="GASTO",
                estatus_etiqueta="PENDIENTE_ETIQUETA",
                estatus_activo="ACTIVO",
                descripcion=clean_str(row.get("Descripción")) or "SIN DESCRIPCIÓN",
                especificacion=clean_str(row.get("Especificación")),
                marca=clean_str(row.get("Marca")),
                modelo=clean_str(row.get("Modelo")),
                numero_serie=clean_str(row.get("Número de Serie")),
                categoria_id=cat_id,
                ubicacion_id=ubi_id,
                resguardante_id=res_id,
                centro_costo=clean_str(row.get("Centro de Costo")) or "PLANTEL 3",
                archivo_fuente="GTO PL 3.xlsx"
            )
            session.add(activo)
            total_creados += 1
            conteo_origen["GASTO"] += 1
            conteo_etiqueta["PENDIENTE_ETIQUETA"] += 1

        session.flush()
        print(f"      -> {len(df_gto)} activos de Gasto importados (en espera de etiqueta verde).")
    else:
        print(f"ADVERTENCIA: No se encontró {gto_path}")

    # -------------------------------------------------------------
    # 4. Procesar C.A. PL 3.xlsx (C.A.)
    # -------------------------------------------------------------
    ca_path = os.path.join(BASE_DIR, "C.A. PL 3.xlsx")
    if os.path.exists(ca_path):
        print(f"\n[3/4] Procesando archivo de C.A.: {os.path.basename(ca_path)}...")
        df_ca = pd.read_excel(ca_path)
        print(f"      Filas encontradas: {len(df_ca)}")

        for idx, row in df_ca.iterrows():
            cod_interno = f"PL3-CA-{idx+1:04d}"

            cat_id = get_or_create(session, Categoria, cat_cache, normalize_categoria(row.get("Categoría")))
            ubi_id = get_or_create(session, Ubicacion, ubi_cache, normalize_ubicacion(row.get("Ubicación Física")))
            res_id = get_or_create(session, Resguardante, res_cache, normalize_resguardante(row.get("Resguardante")))

            activo = Activo(
                codigo_interno=cod_interno,
                codigo_oficial=None,  # Pendiente de etiqueta verde
                origen="C.A.",
                estatus_etiqueta="PENDIENTE_ETIQUETA",
                estatus_activo="ACTIVO",
                descripcion=clean_str(row.get("Descripción")) or "SIN DESCRIPCIÓN",
                especificacion=clean_str(row.get("Especificación")),
                marca=clean_str(row.get("Marca")),
                modelo=clean_str(row.get("Modelo")),
                numero_serie=clean_str(row.get("Número de Serie")),
                categoria_id=cat_id,
                ubicacion_id=ubi_id,
                resguardante_id=res_id,
                centro_costo=clean_str(row.get("Centro de Costo")) or "PLANTEL 3",
                archivo_fuente="C.A. PL 3.xlsx"
            )
            session.add(activo)
            total_creados += 1
            conteo_origen["C.A."] += 1
            conteo_etiqueta["PENDIENTE_ETIQUETA"] += 1

        session.flush()
        print(f"      -> {len(df_ca)} activos de C.A. importados (en espera de etiqueta verde).")
    else:
        print(f"ADVERTENCIA: No se encontró {ca_path}")

    # -------------------------------------------------------------
    # 5. Procesar ARCHIVO PL3 SISTEMA.xlsx (Butacas Auditorio)
    # -------------------------------------------------------------
    arc_path = os.path.join(BASE_DIR, "ARCHIVO PL3 SISTEMA.xlsx")
    if os.path.exists(arc_path):
        print(f"\n[4/4] Procesando archivo de Auditorio: {os.path.basename(arc_path)}...")
        df_arc = pd.read_excel(arc_path)
        print(f"      Filas encontradas: {len(df_arc)}")

        cat_id = get_or_create(session, Categoria, cat_cache, "EQUIPO AUDIOVISUAL")
        ubi_id = get_or_create(session, Ubicacion, ubi_cache, "AUDIOVISUAL")

        for idx, row in df_arc.iterrows():
            cod_num = int(row["Código"])
            cod_oficial = str(cod_num)
            cod_interno = f"PL3-AUD-{cod_num:06d}"

            activo = Activo(
                codigo_interno=cod_interno,
                codigo_oficial=cod_oficial,
                origen="AUDITORIO",
                estatus_etiqueta="ETIQUETADO_OFICIAL",
                estatus_activo="ACTIVO",
                descripcion=clean_str(row.get("Descripción")) or "BUTACA DE AUDITORIO",
                categoria_id=cat_id,
                ubicacion_id=ubi_id,
                centro_costo="PLANTEL 3",
                archivo_fuente="ARCHIVO PL3 SISTEMA.xlsx"
            )
            session.add(activo)
            total_creados += 1
            conteo_origen["AUDITORIO"] += 1
            conteo_etiqueta["ETIQUETADO_OFICIAL"] += 1

        session.flush()
        print(f"      -> {len(df_arc)} activos de Auditorio importados.")
    else:
        print(f"ADVERTENCIA: No se encontró {arc_path}")

    session.commit()
    session.close()

    print("\n==========================================================")
    print("MIGRACIÓN COMPLETADA CON ÉXITO")
    print("==========================================================")
    print(f"Total de activos registrados: {total_creados}")
    print("\nDesglose por Origen:")
    for orig, cnt in conteo_origen.items():
        print(f"  - {orig:12s}: {cnt:4d} activos")
    print("\nDesglose por Estatus de Etiqueta:")
    for est, cnt in conteo_etiqueta.items():
        print(f"  - {est:20s}: {cnt:4d} activos")
    print(f"\nCatálogos Normalizados Creados:")
    print(f"  - Categorías únicas : {len(cat_cache)}")
    print(f"  - Ubicaciones únicas: {len(ubi_cache)}")
    print(f"  - Resguardantes     : {len(res_cache)}")
    print("==========================================================")


if __name__ == "__main__":
    run_migration()

