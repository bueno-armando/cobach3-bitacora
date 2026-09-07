import os
from typing import Optional
from fastapi import FastAPI, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from backend.database import get_db
import backend.crud as crud
from backend.schemas import (
    PaginatedActivosResponse,
    ActivoDetail,
    AsignarEtiquetaRequest,
    CatalogosResponse,
    DashboardStats
)

app = FastAPI(
    title="Sistema de Inventario - COBACH Plantel 3",
    description="API para consulta de activos, control de adquisiciones locales (GTO y C.A.) y conciliación de etiquetas verdes de Bienes Patrimoniales.",
    version="1.0.0"
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
    estatus_etiqueta: Optional[str] = Query(None, description="Filtrar por estatus: PENDIENTE_ETIQUETA, ETIQUETADO_OFICIAL"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
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
        page=page,
        limit=limit
    )


@app.get("/api/activos/{activo_id}", response_model=ActivoDetail, summary="Detalle completo de un activo")
def get_activo_detail(activo_id: int, db: Session = Depends(get_db)):
    return crud.get_activo_by_id(db=db, activo_id=activo_id)


@app.post("/api/activos/{activo_id}/asignar-etiqueta", response_model=ActivoDetail, summary="Asignar código oficial de etiqueta verde")
def asignar_etiqueta(activo_id: int, data: AsignarEtiquetaRequest, db: Session = Depends(get_db)):
    return crud.asignar_etiqueta_oficial(db=db, activo_id=activo_id, data=data)


@app.get("/api/catalogos", response_model=CatalogosResponse, summary="Obtener catálogos de ubicaciones, categorías y resguardantes")
def get_catalogos(db: Session = Depends(get_db)):
    return crud.get_catalogos(db=db)


@app.get("/api/stats", response_model=DashboardStats, summary="Estadísticas generales del inventario")
def get_stats(db: Session = Depends(get_db)):
    return crud.get_dashboard_stats(db=db)


# Montar la carpeta frontend si existe
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
