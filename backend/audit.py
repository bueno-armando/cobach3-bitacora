from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from backend.models import BitacoraLog, Usuario

TZ_CHIHUAHUA = ZoneInfo("America/Chihuahua")


def get_chihuahua_now() -> datetime:
    """Retorna la fecha y hora actual en la zona horaria de Chihuahua (UTC-6) sin tzinfo para almacenamiento uniforme."""
    return datetime.now(TZ_CHIHUAHUA).replace(tzinfo=None)


def registrar_bitacora(
    db: Session,
    usuario: Optional[Usuario],
    operacion: str,
    detalles: str,
    activo_id: Optional[int] = None,
    codigo_activo: Optional[str] = None,
    ip_address: Optional[str] = None
) -> BitacoraLog:
    """
    Registra un evento auditable en la bitácora del sistema (fecha, hora, usuario, operación y detalles).
    """
    u_id = usuario.id if usuario else None
    u_nombre = usuario.username if usuario else "sistema"
    u_rol = usuario.rol if usuario else "sistema"

    log_entry = BitacoraLog(
        fecha_hora=get_chihuahua_now(),
        usuario_id=u_id,
        usuario_nombre=u_nombre,
        usuario_rol=u_rol,
        operacion=operacion.strip().upper(),
        activo_id=activo_id,
        codigo_activo=codigo_activo,
        detalles=detalles,
        ip_address=ip_address
    )
    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)
    return log_entry

