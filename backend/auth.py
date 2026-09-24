import hashlib
import secrets
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Usuario

SECRET_KEY = os.getenv("SECRET_KEY", "cobach3-bitacora-jwt-secret-key-2026-plantel3")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7


def hash_password(password: str) -> str:
    """Hashes a password using PBKDF2-HMAC-SHA256 with a unique salt."""
    salt = secrets.token_hex(16)
    iterations = 100000
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        iterations
    )
    return f"pbkdf2:sha256:{iterations}${salt}${key.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    """Verifies a plain password against the stored PBKDF2 hash using constant-time comparison."""
    try:
        prefix, salt, stored_key = password_hash.split("$")
        _, _, iters_str = prefix.split(":")
        iterations = int(iters_str)
        new_key = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            iterations
        ).hex()
        return secrets.compare_digest(new_key, stored_key)
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Creates a signed JWT with expiration."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


security = HTTPBearer(auto_error=False)


def get_user_from_token_str(token: str, db: Session) -> Usuario:
    """Verifica y decodifica un token JWT retornando el objeto Usuario."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token no contiene identidad de usuario.",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La sesión ha expirado. Inicia sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de acceso inválido.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(Usuario).filter(Usuario.username == username).first()
    if user is None or not user.activo:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado o inactivo.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Usuario:
    """FastAPI dependency to extract and authenticate the current user from Bearer token."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado. Se requiere iniciar sesión.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return get_user_from_token_str(credentials.credentials, db)


def get_current_user_flexible(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    token: Optional[str] = None,
    db: Session = Depends(get_db)
) -> Usuario:
    """Extrae y autentica el usuario ya sea por encabezado Bearer o por query param ?token=."""
    raw_token = None
    if credentials:
        raw_token = credentials.credentials
    elif token:
        raw_token = token

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado. Se requiere iniciar sesión.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return get_user_from_token_str(raw_token, db)


def require_roles(allowed_roles: List[str]):
    """Returns a dependency function verifying that the current user belongs to allowed_roles."""
    def role_checker(current_user: Usuario = Depends(get_current_user)) -> Usuario:
        if current_user.rol not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso insuficiente. Acción reservada para: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker


def require_roles_flexible(allowed_roles: List[str]):
    """Valida roles permitiendo token Bearer en header o query param (útil para descargas directas)."""
    def role_checker(current_user: Usuario = Depends(get_current_user_flexible)) -> Usuario:
        if current_user.rol not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permiso insuficiente. Acción reservada para: {', '.join(allowed_roles)}"
            )
        return current_user
    return role_checker


def seed_default_users(db: Session):
    """Seeds default accounts for each role if they do not exist."""
    defaults = [
        {
            "username": "admin",
            "nombre_completo": "Administrador de Sistemas (Plantel 3)",
            "password_plain": "Cobach3#Admin",
            "rol": "admin"
        },
        {
            "username": "resguardo",
            "nombre_completo": "Personal",
            "password_plain": "Cobach3#Resguardo",
            "rol": "resguardo"
        },
        {
            "username": "consulta",
            "nombre_completo": "Consulta y Auditoría Institucional",
            "password_plain": "Cobach3#Consulta",
            "rol": "consulta"
        }
    ]
    for item in defaults:
        user = db.query(Usuario).filter(Usuario.username == item["username"]).first()
        if not user:
            nuevo = Usuario(
                username=item["username"],
                nombre_completo=item["nombre_completo"],
                password_hash=hash_password(item["password_plain"]),
                rol=item["rol"],
                activo=True
            )
            db.add(nuevo)
        else:
            user.nombre_completo = item["nombre_completo"]
    db.commit()
