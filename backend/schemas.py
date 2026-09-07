from typing import Optional, List, Dict, Any
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict


class CategoriaOut(BaseModel):
    id: int
    nombre: str

    model_config = ConfigDict(from_attributes=True)


class UbicacionOut(BaseModel):
    id: int
    nombre: str

    model_config = ConfigDict(from_attributes=True)


class ResguardanteOut(BaseModel):
    id: int
    nombre: str

    model_config = ConfigDict(from_attributes=True)


class HistorialEtiquetaOut(BaseModel):
    id: int
    codigo_oficial_asignado: str
    asignado_por: Optional[str] = None
    fecha_asignacion: datetime
    notas: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ActivoListItem(BaseModel):
    id: int
    codigo_interno: str
    codigo_oficial: Optional[str] = None
    origen: str
    estatus_etiqueta: str
    estatus_activo: str
    descripcion: str
    marca: Optional[str] = None
    modelo: Optional[str] = None
    numero_serie: Optional[str] = None
    categoria: Optional[str] = None
    ubicacion: Optional[str] = None
    resguardante: Optional[str] = None
    condicion: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ActivoDetail(BaseModel):
    id: int
    codigo_interno: str
    codigo_oficial: Optional[str] = None
    origen: str
    estatus_etiqueta: str
    estatus_activo: str
    descripcion: str
    especificacion: Optional[str] = None
    marca: Optional[str] = None
    modelo: Optional[str] = None
    numero_serie: Optional[str] = None
    categoria: Optional[str] = None
    ubicacion: Optional[str] = None
    resguardante: Optional[str] = None
    familia: Optional[str] = None
    centro_costo: Optional[str] = None
    condicion: Optional[str] = None
    costo: Optional[float] = None
    donacion_tipo: Optional[str] = None
    orden_compra: Optional[str] = None
    numero_factura: Optional[str] = None
    fecha_recepcion: Optional[date] = None
    observaciones: Optional[str] = None
    archivo_fuente: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    historial_etiquetas: List[HistorialEtiquetaOut] = []

    model_config = ConfigDict(from_attributes=True)


class PaginatedActivosResponse(BaseModel):
    total: int
    page: int
    limit: int
    total_pages: int
    items: List[ActivoListItem]


class AsignarEtiquetaRequest(BaseModel):
    codigo_oficial: str
    asignado_por: Optional[str] = "Personal Plantel 3"
    notas: Optional[str] = None


class CatalogosResponse(BaseModel):
    categorias: List[CategoriaOut]
    ubicaciones: List[UbicacionOut]
    resguardantes: List[ResguardanteOut]


class DashboardStats(BaseModel):
    total_activos: int
    total_etiquetados: int
    total_pendientes: int
    por_origen: Dict[str, int]
