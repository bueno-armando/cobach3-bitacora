"""
Módulo de importación de inventario desde hojas de cálculo Excel (.xlsx, .xls)
para el Sistema de Bienes Muebles del COBACH Plantel 3.
Soporta archivos de Gasto, Control Administrativo y Dirección General,
aplicando las reglas ETL de normalización, limpieza y prevención de duplicados.
"""

import io
import re
from datetime import datetime
from typing import Dict, Any, List, Optional
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.models import Activo, Categoria, Ubicacion, Resguardante, Usuario
from backend import crud
from backend.audit import registrar_bitacora


def clean_str(val: Any) -> Optional[str]:
    """Limpia cadenas, elimina espacios redundantes y convierte valores vacíos/'N/A' en None."""
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip()
    s = re.sub(r"\s+", " ", s)
    if s.upper() in {"N/A", "NA", "S/N", "SIN SERIE", "NO TIENE", "NO APLICA", "--", "NONE", "NAN", ""}:
        return None
    return s


def clean_float(val: Any) -> Optional[float]:
    """Convierte un valor numérico a float o retorna None si no es válido."""
    if pd.isna(val) or val is None:
        return None
    try:
        if isinstance(val, (int, float)):
            return float(val)
        s = str(val).replace("$", "").replace(",", "").strip()
        return float(s)
    except (ValueError, TypeError):
        return None


def clean_date(val: Any) -> Optional[datetime.date]:
    """Parsea fechas en formatos variados (DD/MM/YYYY, YYYY-MM-DD, etc.)."""
    if pd.isna(val) or val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    s = str(val).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def normalize_categoria(cat_raw: Any) -> Optional[str]:
    """Normaliza nombres de categorías."""
    cat = clean_str(cat_raw)
    if not cat:
        return None
    cat_up = cat.upper()
    if cat_up in {"EQUIPO DE MUSICA", "EQUIPO DE MÚSICA"}:
        return "EQUIPO DE MÚSICA"
    if ("HERR" in cat_up and "MTTO" in cat_up) or ("HERR" in cat_up and "MANTENIMIENTO" in cat_up):
        return "HERRAMIENTAS Y EQUIPO DE MANTENIMIENTO"
    return cat


def normalize_resguardante(res_raw: Any) -> Optional[str]:
    """Normaliza nombres de resguardantes."""
    res = clean_str(res_raw)
    if not res:
        return None
    res_up = res.upper()
    if "EDGAR" in res_up and "ALVAREZ" in res_up:
        return "DR. EDGAR ÁLVAREZ CASTILLO"
    return res


def normalize_condicion(cond_raw: Any) -> str:
    """Mapea cualquier texto de condición a la escala unificada del Plantel 3."""
    c = clean_str(cond_raw)
    if not c:
        return "Buena"
    c_low = c.lower()
    if "exce" in c_low:
        return "Excelente"
    if "pesim" in c_low or "pésim" in c_low:
        return "Pésima"
    if "mala" in c_low or "regular" in c_low or "chatarra" in c_low:
        return "Mala / Regular"
    return "Buena"


def get_or_create_catalogo(session: Session, model, cache: Dict[str, int], name: Optional[str]) -> Optional[int]:
    """Obtiene el ID de catálogo en caché o lo inserta si es nuevo."""
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


def find_column_value(row: pd.Series, *aliases: str) -> Any:
    """Busca insensible a mayúsculas/tildes el primer valor que coincida con alguno de los alias."""
    row_keys = {str(k).strip().lower(): k for k in row.keys()}
    for alias in aliases:
        a_clean = alias.strip().lower()
        if a_clean in row_keys:
            return row[row_keys[a_clean]]
    return None


def import_excel_activos(
    db: Session,
    file_bytes: bytes,
    origen: str,
    filename: str,
    current_user: Optional[Usuario] = None
) -> Dict[str, Any]:
    """
    Procesa un archivo Excel cargado en memoria y añade los activos al inventario.
    """
    origen_norm = origen.strip().upper()
    if origen_norm not in ("GASTO", "CONTROL ADMINISTRATIVO", "DIRECCION GENERAL"):
        raise ValueError(f"Origen no válido: {origen}. Debe ser GASTO, CONTROL ADMINISTRATIVO o DIRECCION GENERAL.")

    # 1. Leer el archivo con Pandas
    try:
        df = pd.read_excel(io.BytesIO(file_bytes))
    except Exception:
        try:
            # Fallback para archivos .xls que son exportaciones HTML de Dirección General
            tables = pd.read_html(io.BytesIO(file_bytes))
            if not tables:
                raise ValueError("No se encontraron tablas legibles en el archivo.")
            df = tables[0]
        except Exception as e:
            raise ValueError(f"No fue posible leer el archivo Excel: {str(e)}")

    if df.empty:
        return {
            "success": True,
            "origen": origen_norm,
            "total_leidos": 0,
            "creados": 0,
            "omitidos": 0,
            "errores": [],
            "mensaje": "El archivo está vacío."
        }

    cat_cache: Dict[str, int] = {}
    ubi_cache: Dict[str, int] = {}
    res_cache: Dict[str, int] = {}

    total_leidos = 0
    creados = 0
    omitidos = 0
    errores: List[str] = []

    for idx, row in df.iterrows():
        total_leidos += 1
        try:
            # Extracción de campos según alias flexibles
            raw_desc = find_column_value(row, "descripción", "descripcion", "bien", "artículo", "articulo")
            desc = clean_str(raw_desc)
            if not desc:
                omitidos += 1
                continue

            especificacion = clean_str(find_column_value(row, "especificación", "especificacion", "especificaciones"))
            marca = clean_str(find_column_value(row, "marca"))
            modelo = clean_str(find_column_value(row, "modelo"))
            serie = clean_str(find_column_value(row, "número de serie", "numero de serie", "serie", "no. serie"))
            familia = clean_str(find_column_value(row, "familia"))
            costo = clean_float(find_column_value(row, "costo", "precio", "importe", "valor"))
            factura = clean_str(find_column_value(row, "no. de factura", "numero factura", "factura"))
            orden_compra = clean_str(find_column_value(row, "orden de compra", "orden compra"))
            fecha_rec = clean_date(find_column_value(row, "fecha de recepción", "fecha recepcion", "fecha"))
            obs = clean_str(find_column_value(row, "observaciones", "comentarios", "notas"))

            raw_cat = find_column_value(row, "categoría", "categoria", "clasificación", "clasificacion")
            raw_ubi = find_column_value(row, "ubicación fisica", "ubicacion fisica", "ubicación", "ubicacion")
            raw_res = find_column_value(row, "resguardante", "responsable")

            cat_id = get_or_create_catalogo(db, Categoria, cat_cache, normalize_categoria(raw_cat))
            ubi_id = get_or_create_catalogo(db, Ubicacion, ubi_cache, clean_str(raw_ubi))
            res_id = get_or_create_catalogo(db, Resguardante, res_cache, normalize_resguardante(raw_res))

            raw_cond = find_column_value(row, "condición", "condicion", "estado físico", "estado fisico")
            cond_local = normalize_condicion(raw_cond)
            cond_dg = clean_str(raw_cond) if origen_norm == "DIRECCION GENERAL" else None

            # Código oficial (si viene en el archivo)
            raw_cod_oficial = find_column_value(row, "código", "codigo", "codigo_oficial", "etiqueta", "no. inventario")
            codigo_oficial = str(int(raw_cod_oficial)) if (raw_cod_oficial is not None and str(raw_cod_oficial).strip().isdigit()) else clean_str(raw_cod_oficial)

            # Prevención de duplicados:
            # 1. Por código oficial si existe
            if codigo_oficial:
                existente = db.query(Activo).filter(Activo.codigo_oficial == str(codigo_oficial)).first()
                if existente:
                    omitidos += 1
                    continue

            # 2. Por número de serie si no es genérico
            if serie and serie.upper() not in ("S/N", "SIN SERIE", "N/A"):
                existente_serie = db.query(Activo).filter(Activo.numero_serie == serie).first()
                if existente_serie:
                    omitidos += 1
                    continue
            else:
                # 3. Para activos sin serie única ni código oficial:
                # Omitir si ya existe un bien idéntico (misma descripción, marca, modelo, ubicación y resguardante)
                if not codigo_oficial:
                    existente_huella = db.query(Activo).filter(
                        Activo.deleted_at == None,
                        Activo.origen == origen_norm,
                        Activo.descripcion == desc,
                        Activo.marca == marca,
                        Activo.modelo == modelo,
                        Activo.ubicacion_id == ubi_id,
                        Activo.resguardante_id == res_id
                    ).first()
                    if existente_huella:
                        omitidos += 1
                        continue

            # Determinación de código interno y estatus de etiqueta
            if origen_norm == "DIRECCION GENERAL":
                if codigo_oficial:
                    try:
                        cod_num = int(codigo_oficial)
                        cod_interno = f"PL3-DG-{cod_num:06d}"
                    except ValueError:
                        cod_interno = crud.generate_next_codigo_interno(db, "DIRECCION GENERAL")
                    estatus_etiqueta = "ETIQUETADO_OFICIAL"
                else:
                    cod_interno = crud.generate_next_codigo_interno(db, "DIRECCION GENERAL")
                    estatus_etiqueta = "PENDIENTE_ETIQUETA"
            else:
                cod_interno = crud.generate_next_codigo_interno(db, origen_norm)
                estatus_etiqueta = "PENDIENTE_ETIQUETA"

            # Verificar si por alguna razón el código interno ya existe
            dup_interno = db.query(Activo).filter(Activo.codigo_interno == cod_interno).first()
            if dup_interno:
                cod_interno = crud.generate_next_codigo_interno(db, origen_norm)

            estatus_activo = "ACTIVO"
            raw_estatus = find_column_value(row, "estatus", "estado")
            if raw_estatus and "BAJA" in str(raw_estatus).upper():
                estatus_activo = "BAJA"

            nuevo_activo = Activo(
                codigo_interno=cod_interno,
                codigo_oficial=codigo_oficial,
                origen=origen_norm,
                estatus_etiqueta=estatus_etiqueta,
                estatus_activo=estatus_activo,
                descripcion=desc,
                especificacion=especificacion,
                marca=marca,
                modelo=modelo,
                numero_serie=serie,
                categoria_id=cat_id,
                ubicacion_id=ubi_id,
                resguardante_id=res_id,
                familia=familia,
                centro_costo="PLANTEL 3",
                condicion=cond_local,
                condicion_dg=cond_dg,
                condicion_actual=cond_local,
                costo=costo,
                numero_factura=factura,
                orden_compra=orden_compra,
                fecha_recepcion=fecha_rec,
                observaciones=obs,
                archivo_fuente=filename
            )
            db.add(nuevo_activo)
            db.flush()
            creados += 1

        except Exception as row_err:
            errores.append(f"Fila {idx + 1}: {str(row_err)}")

    db.commit()

    registrar_bitacora(
        db=db,
        usuario=current_user,
        operacion="IMPORTACION",
        detalles=f"Importación de Excel ({filename}, Origen: {origen_norm}): {creados} creados, {omitidos} omitidos por ya existir.",
        activo_id=None,
        codigo_activo=None
    )

    return {
        "success": True,
        "origen": origen_norm,
        "total_leidos": total_leidos,
        "creados": creados,
        "omitidos": omitidos,
        "errores": errores[:10],
        "mensaje": f"Se procesaron {total_leidos} filas: {creados} activos creados, {omitidos} omitidos por ya existir."
    }
