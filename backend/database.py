import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./inventario.db")

# Si se usa SQLite, se requiere check_same_thread=False para soportar múltiples hilos en FastAPI
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=False
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """Generador de sesiones de base de datos para inyección de dependencias en FastAPI."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema_migrations(eng=engine):
    """Verifica y aplica migraciones ligeras de columnas para SQLite / PostgreSQL."""
    from sqlalchemy import inspect, text
    inspector = inspect(eng)
    table_names = inspector.get_table_names()
    
    # Crear tablas faltantes (incluyendo bitacora_logs)
    Base.metadata.create_all(bind=eng)

    if "activos" in table_names:
        cols = [c["name"] for c in inspector.get_columns("activos")]
        with eng.connect() as conn:
            if "deleted_at" not in cols:
                conn.execute(text("ALTER TABLE activos ADD COLUMN deleted_at DATETIME"))
                conn.commit()
            if "deleted_by" not in cols:
                conn.execute(text("ALTER TABLE activos ADD COLUMN deleted_by VARCHAR(100)"))
                conn.commit()

