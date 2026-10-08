import os
import datetime
from typing import Optional, List
from fastapi import FastAPI, Depends, Query, status, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from backend.database import get_db, engine, SessionLocal, ensure_schema_migrations
from backend.models import Base, Usuario, Resguardante
import backend.crud as crud
from backend.importer import import_excel_activos
from backend.reportes import generar_resguardo_oficial_excel
from backend.audit import registrar_bitacora
from backend.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    require_roles,
    require_roles_flexible,
    seed_default_users
)
from backend.schemas import (
    PaginatedActivosResponse,
    ActivoListItem,
    ActivoDetail,
    ActivoCreate,
    ActivoUpdate,
    CambiarEstatusRequest,
    AsignarEtiquetaRequest,
    CatalogosResponse,
    ImagenUploadResponse,
    LoginRequest,
    UserResponse,
    TokenResponse,
    ActualizarCondicionRequest,
    BatchIdsRequest,
    ImportExcelResponse,
    BitacoraResponse,
    PapeleraResponse,
    GenerarResguardoRequest,
    ActualizarPuestoRequest
)


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

app = FastAPI(
    title="Sistema de Inventario - COBACH Plantel 3",
    description="API para control, consulta y gestión del ciclo de vida de los activos del Plantel 3.",
    version="1.3.0"
)

# Servir uploads de imágenes
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# Configuración de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    """Garantiza la creación de tablas, migraciones y siembra cuentas iniciales."""
    ensure_schema_migrations(engine)
    db = SessionLocal()
    try:
        seed_default_users(db)
    finally:
        db.close()


# ==========================================
# RUTAS DE AUTENTICACIÓN
# ==========================================

@app.post("/api/auth/login", response_model=TokenResponse, summary="Iniciar sesión y obtener token JWT")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """Valida credenciales de usuario y retorna token Bearer JWT con los datos de rol."""
    username_clean = data.username.strip().lower()
    user = db.query(Usuario).filter(Usuario.username == username_clean).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta cuenta de usuario ha sido desactivada"
        )

    token = create_access_token(data={"sub": user.username, "rol": user.rol})

    registrar_bitacora(
        db=db,
        usuario=user,
        operacion="LOGIN",
        detalles=f"Inicio de sesión exitoso como rol '{user.rol}'"
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }


@app.get("/api/auth/me", response_model=UserResponse, summary="Obtener perfil del usuario autenticado")
def get_me(current_user: Usuario = Depends(get_current_user)):
    """Retorna los datos y rol de la sesión actual."""
    return current_user


# ==========================================
# RUTAS DE ACTIVOS Y BIENES MUEBLES
# ==========================================

@app.get("/api/activos", response_model=PaginatedActivosResponse, summary="Listar y buscar activos con filtros")
def list_activos(
    q: Optional[str] = Query(None, description="Búsqueda por código, serie, descripción, marca o modelo"),
    origen: Optional[str] = Query(None, description="Filtrar por origen: GASTO, C.A., CENTRAL, AUDITORIO"),
    ubicacion_id: Optional[int] = Query(None, description="Filtrar por ID de ubicación"),
    categoria_id: Optional[int] = Query(None, description="Filtrar por ID de categoría"),
    resguardante_id: Optional[int] = Query(None, description="Filtrar por ID de resguardante"),
    estatus_etiqueta: Optional[str] = Query(None, description="Filtrar por estatus etiqueta: PENDIENTE_ETIQUETA, ETIQUETADO_OFICIAL"),
    estatus_activo: Optional[str] = Query(None, description="Filtrar por estatus operativo: OPERATIVO, EN_DESUSO, EN_REPARACION, BAJA"),
    condicion: Optional[str] = Query(None, description="Filtrar por condición física: Excelente, Buena, Mala / Regular, Pésima"),
    discrepancias: Optional[bool] = Query(False, description="Filtrar activos que presentan discrepancias con Dirección General"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=2500),
    current_user: Usuario = Depends(require_roles(["admin", "resguardo", "consulta"])),
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
        condicion=condicion,
        discrepancias=discrepancias,
        page=page,
        limit=limit
    )


@app.post("/api/activos/batch", response_model=List[ActivoListItem], summary="Obtener lote de activos por lista de IDs")
def get_activos_batch(
    data: BatchIdsRequest,
    current_user: Usuario = Depends(require_roles(["admin", "resguardo", "consulta"])),
    db: Session = Depends(get_db)
):
    """Retorna los activos solicitados en una única consulta optimizada."""
    return crud.get_activos_by_ids(db=db, ids=data.ids)


@app.post("/api/activos", response_model=ActivoDetail, status_code=status.HTTP_201_CREATED, summary="Registrar nuevo activo")
def create_activo(
    data: ActivoCreate,
    current_user: Usuario = Depends(require_roles(["admin", "resguardo"])),
    db: Session = Depends(get_db)
):
    return crud.create_activo(db=db, data=data, current_user=current_user)


@app.get("/api/activos/{activo_id}", response_model=ActivoDetail, summary="Detalle completo de un activo")
def get_activo_detail(
    activo_id: int,
    current_user: Usuario = Depends(require_roles(["admin", "resguardo", "consulta"])),
    db: Session = Depends(get_db)
):
    return crud.get_activo_by_id(db=db, activo_id=activo_id)


@app.put("/api/activos/{activo_id}", response_model=ActivoDetail, summary="Modificar datos de un activo existente")
def update_activo(
    activo_id: int,
    data: ActivoUpdate,
    current_user: Usuario = Depends(require_roles(["admin"])),
    db: Session = Depends(get_db)
):
    return crud.update_activo(db=db, activo_id=activo_id, data=data, current_user=current_user)


@app.delete("/api/activos/{activo_id}", summary="Mover activo a papelera de reciclaje")
def delete_activo(
    activo_id: int,
    current_user: Usuario = Depends(require_roles(["admin"])),
    db: Session = Depends(get_db)
):
    return crud.delete_activo(db=db, activo_id=activo_id, current_user=current_user)


@app.post("/api/activos/{activo_id}/restaurar", summary="Restaurar activo de la papelera")
def restore_activo(
    activo_id: int,
    current_user: Usuario = Depends(require_roles(["admin"])),
    db: Session = Depends(get_db)
):
    return crud.restore_activo(db=db, activo_id=activo_id, current_user=current_user)


@app.delete("/api/activos/{activo_id}/permanente", summary="Eliminar activo definitivamente (purgar)")
def purge_activo(
    activo_id: int,
    current_user: Usuario = Depends(require_roles(["admin"])),
    db: Session = Depends(get_db)
):
    return crud.purge_activo(db=db, activo_id=activo_id, current_user=current_user)


@app.get("/api/activos/papelera/lista", response_model=PapeleraResponse, summary="Listar activos en la papelera de reciclaje")
def list_papelera(
    current_user: Usuario = Depends(require_roles(["admin"])),
    db: Session = Depends(get_db)
):
    return crud.get_papelera(db=db)


@app.get("/api/bitacora", response_model=BitacoraResponse, summary="Consultar bitácora de auditoría del sistema")
def get_bitacora_logs(
    operacion: Optional[str] = Query(None, description="Filtrar por operación"),
    usuario: Optional[str] = Query(None, description="Filtrar por nombre de usuario"),
    q: Optional[str] = Query(None, description="Búsqueda en detalles o código"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_user: Usuario = Depends(require_roles(["admin"])),
    db: Session = Depends(get_db)
):
    return crud.get_bitacora(
        db=db,
        operacion=operacion,
        usuario=usuario,
        q=q,
        page=page,
        limit=limit
    )


@app.post("/api/reportes/resguardo-oficial", summary="Generar reporte institucional FOR-DAD_06 de Resguardo en Excel")
def export_resguardo_oficial(
    data: GenerarResguardoRequest,
    current_user: Usuario = Depends(require_roles(["admin", "resguardo"])),
    db: Session = Depends(get_db)
):
    excel_stream = generar_resguardo_oficial_excel(
        db=db,
        resguardante_id=data.resguardante_id,
        activo_ids=data.activo_ids,
        puesto=data.puesto
    )
    date_str = datetime.date.today().strftime("%Y-%m-%d")
    filename = f"Resguardo_Oficial_FOR-DAD_06_{date_str}.xlsx"

    return StreamingResponse(
        excel_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


@app.patch("/api/resguardantes/{resguardante_id}/puesto", summary="Actualizar puesto de un resguardante en catálogo")
def update_resguardante_puesto(
    resguardante_id: int,
    data: ActualizarPuestoRequest,
    current_user: Usuario = Depends(require_roles(["admin", "resguardo"])),
    db: Session = Depends(get_db)
):
    resg = db.query(Resguardante).filter(Resguardante.id == resguardante_id).first()
    if not resg:
        raise HTTPException(status_code=404, detail="Resguardante no encontrado")
    
    nuevo_puesto = data.puesto.strip().upper() if (data.puesto and data.puesto.strip()) else None
    resg.puesto = nuevo_puesto
    db.commit()
    return {"message": "Puesto actualizado correctamente", "resguardante_id": resg.id, "puesto": resg.puesto}



@app.patch("/api/activos/{activo_id}/estatus-operativo", response_model=ActivoDetail, summary="Cambiar estado físico/operativo (Operativo, En Desuso, etc.)")
def change_operational_status(
    activo_id: int,
    data: CambiarEstatusRequest,
    current_user: Usuario = Depends(require_roles(["admin", "resguardo"])),
    db: Session = Depends(get_db)
):
    return crud.cambiar_estatus_operativo(db=db, activo_id=activo_id, data=data)


@app.patch("/api/activos/{activo_id}/condicion", response_model=ActivoDetail, summary="Reportar condición física y/o estatus operativo de resguardo")
def update_activo_condicion(
    activo_id: int,
    data: ActualizarCondicionRequest,
    current_user: Usuario = Depends(require_roles(["admin", "resguardo"])),
    db: Session = Depends(get_db)
):
    return crud.update_condicion_resguardo(
        db=db,
        activo_id=activo_id,
        data=data,
        usuario=current_user
    )


@app.post("/api/activos/{activo_id}/asignar-etiqueta", response_model=ActivoDetail, summary="Asignar código oficial de etiqueta verde")
def asignar_etiqueta(
    activo_id: int,
    data: AsignarEtiquetaRequest,
    current_user: Usuario = Depends(require_roles(["admin"])),
    db: Session = Depends(get_db)
):
    return crud.asignar_etiqueta_oficial(db=db, activo_id=activo_id, data=data, usuario=current_user)


@app.post("/api/activos/{activo_id}/imagen", response_model=ImagenUploadResponse, summary="Subir imagen de activo con opción de propagación a modelo")
async def upload_activo_imagen(
    activo_id: int,
    file: UploadFile = File(...),
    propagate_model: bool = Form(False),
    override_custom: bool = Form(False),
    current_user: Usuario = Depends(require_roles(["admin", "resguardo"])),
    db: Session = Depends(get_db)
):
    filename = file.filename or "imagen.jpg"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        raise HTTPException(status_code=400, detail="Formato no admitido. Usa imágenes JPG, PNG o WEBP.")

    timestamp = int(datetime.datetime.now().timestamp())
    saved_filename = f"activo_{activo_id}_{timestamp}{ext}"
    file_path = os.path.join(UPLOADS_DIR, saved_filename)

    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    imagen_url = f"/uploads/{saved_filename}"

    return crud.set_activo_imagen(
        db=db,
        activo_id=activo_id,
        imagen_url=imagen_url,
        propagate_model=propagate_model,
        override_custom=override_custom,
        usuario=current_user
    )


@app.delete("/api/activos/{activo_id}/imagen", summary="Eliminar imagen asignada al activo")
def delete_activo_imagen(
    activo_id: int,
    current_user: Usuario = Depends(require_roles(["admin", "resguardo"])),
    db: Session = Depends(get_db)
):
    return crud.delete_activo_imagen(db=db, activo_id=activo_id, usuario=current_user)


@app.get("/api/catalogos", response_model=CatalogosResponse, summary="Obtener catálogos de ubicaciones, categorías y resguardantes")
def get_catalogos(
    current_user: Usuario = Depends(require_roles(["admin", "resguardo", "consulta"])),
    db: Session = Depends(get_db)
):
    return crud.get_catalogos(db=db)


@app.get("/api/stats", summary="Estadísticas generales del inventario")
def get_stats(
    current_user: Usuario = Depends(require_roles(["admin", "resguardo", "consulta"])),
    db: Session = Depends(get_db)
):
    return crud.get_dashboard_stats(db=db)


@app.get("/api/export/excel", summary="Exportar inventario a hoja de cálculo Excel (.xlsx)")
def export_excel(
    q: Optional[str] = Query(None, description="Búsqueda por texto"),
    origen: Optional[str] = Query(None, description="Filtrar por origen"),
    ubicacion_id: Optional[int] = Query(None, description="Filtrar por ubicación"),
    categoria_id: Optional[int] = Query(None, description="Filtrar por categoría"),
    resguardante_id: Optional[int] = Query(None, description="Filtrar por resguardante"),
    estatus_etiqueta: Optional[str] = Query(None, description="Filtrar por estatus etiqueta"),
    estatus_activo: Optional[str] = Query(None, description="Filtrar por estatus operativo"),
    condicion: Optional[str] = Query(None, description="Filtrar por condición física"),
    discrepancias: Optional[bool] = Query(False, description="Filtrar por discrepancias con D.G."),
    ids: Optional[str] = Query(None, description="Lista de IDs separados por coma para selección"),
    scope: Optional[str] = Query(None, description="Nombre descriptivo del ámbito (ej. GASTO, SELECCION)"),
    columnas: Optional[str] = Query(None, description="Lista de columnas separadas por comas a incluir"),
    token: Optional[str] = Query(None, description="Token JWT para descargas directas"),
    current_user: Usuario = Depends(require_roles_flexible(["admin", "resguardo", "consulta"])),
    db: Session = Depends(get_db)
):
    id_list = None
    if ids and ids.strip():
        try:
            id_list = [int(x.strip()) for x in ids.split(",") if x.strip().isdigit()]
        except Exception:
            id_list = None

    columnas_list = [c.strip() for c in columnas.split(",") if c.strip()] if columnas and columnas.strip() else None

    excel_stream = crud.export_activos_to_excel(
        db=db,
        q=q,
        origen=origen,
        ubicacion_id=ubicacion_id,
        categoria_id=categoria_id,
        resguardante_id=resguardante_id,
        estatus_etiqueta=estatus_etiqueta,
        estatus_activo=estatus_activo,
        condicion=condicion,
        discrepancias=discrepancias,
        ids=id_list,
        columnas=columnas_list
    )

    date_str = datetime.date.today().strftime("%Y-%m-%d")
    scope_suffix = f"_{scope.strip().upper()}" if scope and scope.strip() else (f"_{origen.strip().upper()}" if origen else "")
    filename = f"BienesMuebles_COBACH3{scope_suffix}_{date_str}.xlsx"

    return StreamingResponse(
        excel_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


@app.post("/api/import/excel", response_model=ImportExcelResponse, summary="Importar activos masivamente desde hoja Excel")
async def import_excel(
    file: UploadFile = File(...),
    origen: str = Form(...),
    current_user: Usuario = Depends(require_roles(["admin"])),
    db: Session = Depends(get_db)
):
    """Procesa y carga un archivo Excel (Gasto, Control Admin o Dirección General). Exclusivo de administrador."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Solo se admiten archivos Excel (.xlsx o .xls)")
    content = await file.read()
    try:
        resultado = import_excel_activos(
            db=db,
            file_bytes=content,
            origen=origen,
            filename=file.filename,
            current_user=current_user
        )
        return resultado
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# Montar la carpeta frontend si existe
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

