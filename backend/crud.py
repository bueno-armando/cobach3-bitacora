import math
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func
from fastapi import HTTPException

from backend.models import Activo, Categoria, Ubicacion, Resguardante, HistorialEtiqueta
from backend.schemas import AsignarEtiquetaRequest, ActivoListItem, ActivoDetail


def get_activos(
    db: Session,
    q: Optional[str] = None,
    origen: Optional[str] = None,
    ubicacion_id: Optional[int] = None,
    categoria_id: Optional[int] = None,
    resguardante_id: Optional[int] = None,
    estatus_etiqueta: Optional[str] = None,
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

    activos = query.order_by(Activo.id.asc()).offset(offset).limit(limit).all()

    items = []
    for a in activos:
        items.append(
            ActivoListItem(
                id=a.id,
                codigo_interno=a.codigo_interno,
                codigo_oficial=a.codigo_oficial,
                origen=a.origen,
                estatus_etiqueta=a.estatus_etiqueta,
                estatus_activo=a.estatus_activo,
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

    return ActivoDetail(
        id=activo.id,
        codigo_interno=activo.codigo_interno,
        codigo_oficial=activo.codigo_oficial,
        origen=activo.origen,
        estatus_etiqueta=activo.estatus_etiqueta,
        estatus_activo=activo.estatus_activo,
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

    origenes = db.query(Activo.origen, func.count(Activo.id)).group_by(Activo.origen).all()
    por_origen = {orig: count for orig, count in origenes}

    return {
        "total_activos": total_activos,
        "total_etiquetados": total_etiquetados,
        "total_pendientes": total_pendientes,
        "por_origen": por_origen
    }
