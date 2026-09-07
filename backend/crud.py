import math
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func
from fastapi import HTTPException

from backend.models import Activo, Categoria, Ubicacion, Resguardante, HistorialEtiqueta
from backend.schemas import (
    AsignarEtiquetaRequest,
    ActivoListItem,
    ActivoDetail,
    ActivoCreate,
    ActivoUpdate,
    CambiarEstatusRequest
)


def get_activos(
    db: Session,
    q: Optional[str] = None,
    origen: Optional[str] = None,
    ubicacion_id: Optional[int] = None,
    categoria_id: Optional[int] = None,
    resguardante_id: Optional[int] = None,
    estatus_etiqueta: Optional[str] = None,
    estatus_activo: Optional[str] = None,
    page: int = 1,
    limit: int = 50
) -> Dict[str, Any]:
    query = db.query(Activo).options(
        joinedload(Activo.categoria),
        joinedload(Activo.ubicacion),
        joinedload(Activo.resguardante)
    )

    if origen:
        query = query.filter(Activo.origen == origen)

    if estatus_etiqueta:
        query = query.filter(Activo.estatus_etiqueta == estatus_etiqueta)

    if estatus_activo:
        est_up = estatus_activo.strip().upper()
        if est_up in ("OPERATIVO", "ACTIVO"):
            query = query.filter(Activo.estatus_activo.in_(["OPERATIVO", "ACTIVO"]))
        else:
            query = query.filter(Activo.estatus_activo == est_up)

    if ubicacion_id:
        query = query.filter(Activo.ubicacion_id == ubicacion_id)

    if categoria_id:
        query = query.filter(Activo.categoria_id == categoria_id)

    if resguardante_id:
        query = query.filter(Activo.resguardante_id == resguardante_id)

    # Búsqueda inteligente por texto general (códigos, descripción, marca, serie, ubicación, etc.)
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Activo.codigo_oficial.ilike(term),
                Activo.codigo_interno.ilike(term),
                Activo.numero_serie.ilike(term),
                Activo.descripcion.ilike(term),
                Activo.marca.ilike(term),
                Activo.modelo.ilike(term),
                Activo.especificacion.ilike(term),
                Activo.ubicacion.has(Ubicacion.nombre.ilike(term)),
                Activo.categoria.has(Categoria.nombre.ilike(term)),
                Activo.resguardante.has(Resguardante.nombre.ilike(term))
            )
        )

    total = query.count()
    total_pages = math.ceil(total / limit) if total > 0 else 1
    offset = (page - 1) * limit

    activos = query.order_by(Activo.id.desc()).offset(offset).limit(limit).all()

    items = []
    for a in activos:
        # Normalizar estatus_activo a OPERATIVO si dice ACTIVO
        norm_estatus_activo = "OPERATIVO" if a.estatus_activo == "ACTIVO" else a.estatus_activo
        items.append(
            ActivoListItem(
                id=a.id,
                codigo_interno=a.codigo_interno,
                codigo_oficial=a.codigo_oficial,
                origen=a.origen,
                estatus_etiqueta=a.estatus_etiqueta,
                estatus_activo=norm_estatus_activo,
                descripcion=a.descripcion,
                marca=a.marca,
                modelo=a.modelo,
                numero_serie=a.numero_serie,
                categoria=a.categoria.nombre if a.categoria else None,
                ubicacion=a.ubicacion.nombre if a.ubicacion else None,
                resguardante=a.resguardante.nombre if a.resguardante else None,
                condicion=a.condicion
            )
        )

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
        "items": items
    }


def get_activo_by_id(db: Session, activo_id: int) -> ActivoDetail:
    activo = db.query(Activo).options(
        joinedload(Activo.categoria),
        joinedload(Activo.ubicacion),
        joinedload(Activo.resguardante),
        joinedload(Activo.historial_etiquetas)
    ).filter(Activo.id == activo_id).first()

    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo con ID {activo_id} no encontrado")

    norm_estatus_activo = "OPERATIVO" if activo.estatus_activo == "ACTIVO" else activo.estatus_activo

    return ActivoDetail(
        id=activo.id,
        codigo_interno=activo.codigo_interno,
        codigo_oficial=activo.codigo_oficial,
        origen=activo.origen,
        estatus_etiqueta=activo.estatus_etiqueta,
        estatus_activo=norm_estatus_activo,
        descripcion=activo.descripcion,
        especificacion=activo.especificacion,
        marca=activo.marca,
        modelo=activo.modelo,
        numero_serie=activo.numero_serie,
        categoria=activo.categoria.nombre if activo.categoria else None,
        ubicacion=activo.ubicacion.nombre if activo.ubicacion else None,
        resguardante=activo.resguardante.nombre if activo.resguardante else None,
        familia=activo.familia,
        centro_costo=activo.centro_costo,
        condicion=activo.condicion,
        costo=activo.costo,
        donacion_tipo=activo.donacion_tipo,
        orden_compra=activo.orden_compra,
        numero_factura=activo.numero_factura,
        fecha_recepcion=activo.fecha_recepcion,
        observaciones=activo.observaciones,
        archivo_fuente=activo.archivo_fuente,
        created_at=activo.created_at,
        updated_at=activo.updated_at,
        historial_etiquetas=activo.historial_etiquetas
    )


def generate_next_codigo_interno(db: Session, origen: str) -> str:
    """Genera el siguiente consecutivo de código interno según el origen."""
    prefix_map = {
        "GASTO": "PL3-GTO",
        "C.A.": "PL3-CA",
        "CENTRAL": "PL3-CEN",
        "AUDITORIO": "PL3-AUD"
    }
    pfx = prefix_map.get(origen, "PL3-ACT")

    max_num = 0
    activos = db.query(Activo.codigo_interno).filter(Activo.codigo_interno.like(f"{pfx}-%")).all()
    for (cod,) in activos:
        try:
            parts = cod.split("-")
            num = int(parts[-1])
            if num > max_num:
                max_num = num
        except (ValueError, IndexError):
            pass

    return f"{pfx}-{max_num + 1:04d}"


def get_or_create_lookup(db: Session, model, id_val: Optional[int], name_val: Optional[str]) -> Optional[int]:
    """Resuelve el ID de un catálogo foráneo o crea el registro si se pasa un nuevo nombre."""
    if id_val:
        return id_val
    if name_val and name_val.strip():
        name_clean = name_val.strip()
        obj = db.query(model).filter(func.upper(model.nombre) == name_clean.upper()).first()
        if not obj:
            obj = model(nombre=name_clean)
            db.add(obj)
            db.flush()
        return obj.id
    return None


def create_activo(db: Session, data: ActivoCreate) -> ActivoDetail:
    """Crea un nuevo activo en la base de datos con validaciones completas."""
    # 1. Resolver código interno
    cod_interno = (data.codigo_interno or "").strip()
    if not cod_interno:
        cod_interno = generate_next_codigo_interno(db, data.origen)

    # Validar unicidad de codigo_interno
    existente_interno = db.query(Activo).filter(Activo.codigo_interno == cod_interno).first()
    if existente_interno:
        raise HTTPException(
            status_code=400,
            detail=f"El código interno '{cod_interno}' ya existe en el sistema."
        )

    # 2. Resolver código oficial si se provee
    cod_oficial = (data.codigo_oficial or "").strip() or None
    estatus_etiqueta = "PENDIENTE_ETIQUETA"
    if cod_oficial:
        existente_oficial = db.query(Activo).filter(Activo.codigo_oficial == cod_oficial).first()
        if existente_oficial:
            raise HTTPException(
                status_code=400,
                detail=f"El código oficial '{cod_oficial}' ya está asignado al activo ID {existente_oficial.id}."
            )
        estatus_etiqueta = "ETIQUETADO_OFICIAL"

    # 3. Resolver catálogos
    cat_id = get_or_create_lookup(db, Categoria, data.categoria_id, data.categoria_nombre)
    ubi_id = get_or_create_lookup(db, Ubicacion, data.ubicacion_id, data.ubicacion_nombre)
    res_id = get_or_create_lookup(db, Resguardante, data.resguardante_id, data.resguardante_nombre)

    est_operativo = (data.estatus_operativo or "OPERATIVO").strip().upper()
    if est_operativo == "ACTIVO":
        est_operativo = "OPERATIVO"

    nuevo = Activo(
        codigo_interno=cod_interno,
        codigo_oficial=cod_oficial,
        origen=data.origen,
        estatus_etiqueta=estatus_etiqueta,
        estatus_activo=est_operativo,
        descripcion=data.descripcion.strip(),
        especificacion=data.especificacion.strip() if data.especificacion else None,
        marca=data.marca.strip() if data.marca else None,
        modelo=data.modelo.strip() if data.modelo else None,
        numero_serie=data.numero_serie.strip() if data.numero_serie else None,
        categoria_id=cat_id,
        ubicacion_id=ubi_id,
        resguardante_id=res_id,
        condicion=data.condicion,
        costo=data.costo,
        numero_factura=data.numero_factura,
        orden_compra=data.orden_compra,
        observaciones=data.observaciones,
        archivo_fuente="registro_manual"
    )

    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)

    return get_activo_by_id(db, nuevo.id)


def update_activo(db: Session, activo_id: int, data: ActivoUpdate) -> ActivoDetail:
    """Actualiza los campos de un activo existente."""
    activo = db.query(Activo).filter(Activo.id == activo_id).first()
    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo con ID {activo_id} no encontrado")

    # Validar codigo_interno si se cambia
    if data.codigo_interno is not None:
        cod_interno_nuevo = data.codigo_interno.strip()
        if cod_interno_nuevo and cod_interno_nuevo != activo.codigo_interno:
            existente = db.query(Activo).filter(Activo.codigo_interno == cod_interno_nuevo, Activo.id != activo_id).first()
            if existente:
                raise HTTPException(status_code=400, detail=f"El código interno '{cod_interno_nuevo}' ya está en uso.")
            activo.codigo_interno = cod_interno_nuevo

    # Validar codigo_oficial si se cambia
    if data.codigo_oficial is not None:
        cod_oficial_nuevo = data.codigo_oficial.strip() or None
        if cod_oficial_nuevo:
            existente = db.query(Activo).filter(Activo.codigo_oficial == cod_oficial_nuevo, Activo.id != activo_id).first()
            if existente:
                raise HTTPException(status_code=400, detail=f"El código oficial '{cod_oficial_nuevo}' ya está en uso.")
            activo.codigo_oficial = cod_oficial_nuevo
            activo.estatus_etiqueta = "ETIQUETADO_OFICIAL"
        else:
            activo.codigo_oficial = None
            activo.estatus_etiqueta = "PENDIENTE_ETIQUETA"

    if data.descripcion is not None:
        activo.descripcion = data.descripcion.strip()
    if data.especificacion is not None:
        activo.especificacion = data.especificacion.strip() or None
    if data.marca is not None:
        activo.marca = data.marca.strip() or None
    if data.modelo is not None:
        activo.modelo = data.modelo.strip() or None
    if data.numero_serie is not None:
        activo.numero_serie = data.numero_serie.strip() or None
    if data.origen is not None:
        activo.origen = data.origen
    if data.estatus_operativo is not None:
        est = data.estatus_operativo.strip().upper()
        activo.estatus_activo = "OPERATIVO" if est == "ACTIVO" else est
    if data.condicion is not None:
        activo.condicion = data.condicion
    if data.costo is not None:
        activo.costo = data.costo
    if data.numero_factura is not None:
        activo.numero_factura = data.numero_factura
    if data.orden_compra is not None:
        activo.orden_compra = data.orden_compra
    if data.observaciones is not None:
        activo.observaciones = data.observaciones

    # Catálogos
    if data.categoria_id is not None or data.categoria_nombre is not None:
        activo.categoria_id = get_or_create_lookup(db, Categoria, data.categoria_id, data.categoria_nombre)
    if data.ubicacion_id is not None or data.ubicacion_nombre is not None:
        activo.ubicacion_id = get_or_create_lookup(db, Ubicacion, data.ubicacion_id, data.ubicacion_nombre)
    if data.resguardante_id is not None or data.resguardante_nombre is not None:
        activo.resguardante_id = get_or_create_lookup(db, Resguardante, data.resguardante_id, data.resguardante_nombre)

    db.commit()
    db.refresh(activo)

    return get_activo_by_id(db, activo.id)


def delete_activo(db: Session, activo_id: int) -> Dict[str, Any]:
    """Elimina un activo por ID."""
    activo = db.query(Activo).filter(Activo.id == activo_id).first()
    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo con ID {activo_id} no encontrado")

    desc = activo.descripcion
    cod = activo.codigo_interno
    db.delete(activo)
    db.commit()

    return {"success": True, "message": f"Activo {cod} ({desc}) eliminado con éxito"}


def cambiar_estatus_operativo(db: Session, activo_id: int, data: CambiarEstatusRequest) -> ActivoDetail:
    """Cambia el estado físico/operativo de un bien (OPERATIVO, EN_DESUSO, EN_REPARACION, BAJA)."""
    activo = db.query(Activo).filter(Activo.id == activo_id).first()
    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo con ID {activo_id} no encontrado")

    est_limpio = data.estatus.strip().upper()
    if est_limpio not in ("OPERATIVO", "ACTIVO", "EN_DESUSO", "EN_REPARACION", "BAJA"):
        raise HTTPException(status_code=400, detail=f"Estatus '{data.estatus}' no válido.")

    activo.estatus_activo = "OPERATIVO" if est_limpio == "ACTIVO" else est_limpio

    if data.motivo:
        nota = f"[Cambio a {activo.estatus_activo}]: {data.motivo.strip()}"
        activo.observaciones = f"{activo.observaciones}\n{nota}" if activo.observaciones else nota

    db.commit()
    db.refresh(activo)

    return get_activo_by_id(db, activo.id)


def asignar_etiqueta_oficial(db: Session, activo_id: int, data: AsignarEtiquetaRequest) -> ActivoDetail:
    activo = db.query(Activo).filter(Activo.id == activo_id).first()
    if not activo:
        raise HTTPException(status_code=404, detail=f"Activo con ID {activo_id} no encontrado")

    codigo_limpio = data.codigo_oficial.strip()
    if not codigo_limpio:
        raise HTTPException(status_code=400, detail="El código de etiqueta verde no puede estar vacío")

    # Validar si ya existe otro activo con este código oficial
    existente = db.query(Activo).filter(Activo.codigo_oficial == codigo_limpio, Activo.id != activo_id).first()
    if existente:
        raise HTTPException(
            status_code=400,
            detail=f"El código oficial '{codigo_limpio}' ya está asignado al activo ID {existente.id} ({existente.descripcion})"
        )

    # Actualizar estado y código
    activo.codigo_oficial = codigo_limpio
    activo.estatus_etiqueta = "ETIQUETADO_OFICIAL"

    # Registrar en historial para auditoría
    historial = HistorialEtiqueta(
        activo_id=activo.id,
        codigo_oficial_asignado=codigo_limpio,
        asignado_por=data.asignado_por or "Personal Plantel 3",
        notas=data.notas
    )
    db.add(historial)
    db.commit()
    db.refresh(activo)

    return get_activo_by_id(db, activo.id)


def get_catalogos(db: Session) -> Dict[str, Any]:
    categorias = db.query(Categoria).order_by(Categoria.nombre.asc()).all()
    ubicaciones = db.query(Ubicacion).order_by(Ubicacion.nombre.asc()).all()
    resguardantes = db.query(Resguardante).order_by(Resguardante.nombre.asc()).all()
    return {
        "categorias": categorias,
        "ubicaciones": ubicaciones,
        "resguardantes": resguardantes
    }


def get_dashboard_stats(db: Session) -> Dict[str, Any]:
    total_activos = db.query(func.count(Activo.id)).scalar() or 0
    total_etiquetados = db.query(func.count(Activo.id)).filter(Activo.estatus_etiqueta == "ETIQUETADO_OFICIAL").scalar() or 0
    total_pendientes = db.query(func.count(Activo.id)).filter(Activo.estatus_etiqueta == "PENDIENTE_ETIQUETA").scalar() or 0

    # Desglose por origen
    origenes = db.query(Activo.origen, func.count(Activo.id)).group_by(Activo.origen).all()
    por_origen = {orig: count for orig, count in origenes}

    # Desglose por estado operativo
    total_operativos = db.query(func.count(Activo.id)).filter(Activo.estatus_activo.in_(["OPERATIVO", "ACTIVO"])).scalar() or 0
    total_desuso = db.query(func.count(Activo.id)).filter(Activo.estatus_activo == "EN_DESUSO").scalar() or 0
    total_reparacion = db.query(func.count(Activo.id)).filter(Activo.estatus_activo == "EN_REPARACION").scalar() or 0
    total_baja = db.query(func.count(Activo.id)).filter(Activo.estatus_activo == "BAJA").scalar() or 0

    return {
        "total_activos": total_activos,
        "total_etiquetados": total_etiquetados,
        "total_pendientes": total_pendientes,
        "por_origen": por_origen,
        "estatus_operativo": {
            "operativos": total_operativos,
            "en_desuso": total_desuso,
            "en_reparacion": total_reparacion,
            "bajas": total_baja
        }
    }
