import os
from typing import Optional
from fastapi import FastAPI, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from backend.database import get_db
import backend.crud as crud
from backend.schemas import (
    PaginatedActivosResponse,
    ActivoDetail,
    ActivoCreate,
    ActivoUpdate,
    CambiarEstatusRequest,
    AsignarEtiquetaRequest,
    CatalogosResponse
)

app = FastAPI(
    title="Sistema de Inventario - COBACH Plantel 3",
    description="API para control, consulta y gestión del ciclo de vida de los activos del Plantel 3.",
    version="1.1.0"
)

# Configuración de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/activos", response_model=PaginatedActivosResponse, summary="Listar y buscar activos con filtros")
def list_activos(
    q: Optional[str] = Query(None, description="Búsqueda por código, serie, descripción, marca o modelo"),
    origen: Optional[str] = Query(None, description="Filtrar por origen: GASTO, C.A., CENTRAL, AUDITORIO"),
    ubicacion_id: Optional[int] = Query(None, description="Filtrar por ID de ubicación"),
    categoria_id: Optional[int] = Query(None, description="Filtrar por ID de categoría"),
    resguardante_id: Optional[int] = Query(None, description="Filtrar por ID de resguardante"),
    estatus_etiqueta: Optional[str] = Query(None, description="Filtrar por estatus etiqueta: PENDIENTE_ETIQUETA, ETIQUETADO_OFICIAL"),
    estatus_activo: Optional[str] = Query(None, description="Filtrar por estatus operativo: OPERATIVO, EN_DESUSO, EN_REPARACION, BAJA"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=2500),
    db: Session = Depends(get_db)
):
    return crud.get_activos(
        db=db,
        q=q,
        origen=origen,
        ubicacion_id=ubicacion_id,
        categoria_id=categoria_id,
        resguardante_id=resguardante_id,
        estatus_etiqueta=estatus_etiqueta,
        estatus_activo=estatus_activo,
        page=page,
        limit=limit
    )


@app.post("/api/activos", response_model=ActivoDetail, status_code=status.HTTP_201_CREATED, summary="Registrar nuevo activo")
def create_activo(data: ActivoCreate, db: Session = Depends(get_db)):
    return crud.create_activo(db=db, data=data)


@app.get("/api/activos/{activo_id}", response_model=ActivoDetail, summary="Detalle completo de un activo")
def get_activo_detail(activo_id: int, db: Session = Depends(get_db)):
    return crud.get_activo_by_id(db=db, activo_id=activo_id)


@app.put("/api/activos/{activo_id}", response_model=ActivoDetail, summary="Modificar datos de un activo existente")
def update_activo(activo_id: int, data: ActivoUpdate, db: Session = Depends(get_db)):
    return crud.update_activo(db=db, activo_id=activo_id, data=data)


@app.delete("/api/activos/{activo_id}", summary="Eliminar un activo")
def delete_activo(activo_id: int, db: Session = Depends(get_db)):
    return crud.delete_activo(db=db, activo_id=activo_id)


@app.patch("/api/activos/{activo_id}/estatus-operativo", response_model=ActivoDetail, summary="Cambiar estado físico/operativo (Operativo, En Desuso, etc.)")
def change_operational_status(activo_id: int, data: CambiarEstatusRequest, db: Session = Depends(get_db)):
    return crud.cambiar_estatus_operativo(db=db, activo_id=activo_id, data=data)


@app.post("/api/activos/{activo_id}/asignar-etiqueta", response_model=ActivoDetail, summary="Asignar código oficial de etiqueta verde")
def asignar_etiqueta(activo_id: int, data: AsignarEtiquetaRequest, db: Session = Depends(get_db)):
    return crud.asignar_etiqueta_oficial(db=db, activo_id=activo_id, data=data)


@app.get("/api/catalogos", response_model=CatalogosResponse, summary="Obtener catálogos de ubicaciones, categorías y resguardantes")
def get_catalogos(db: Session = Depends(get_db)):
    return crud.get_catalogos(db=db)


@app.get("/api/stats", summary="Estadísticas generales del inventario")
def get_stats(db: Session = Depends(get_db)):
    return crud.get_dashboard_stats(db=db)


# Montar la carpeta frontend si existe
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
