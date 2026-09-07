from sqlalchemy import Column, Integer, String, Text, Float, Boolean, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from backend.database import Base

class Categoria(Base):
    __tablename__ = "categorias"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(150), unique=True, nullable=False, index=True)

    activos = relationship("Activo", back_populates="categoria")

    def __repr__(self):
        return f"<Categoria {self.nombre}>"


class Ubicacion(Base):
    __tablename__ = "ubicaciones"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(255), unique=True, nullable=False, index=True)

    activos = relationship("Activo", back_populates="ubicacion")

    def __repr__(self):
        return f"<Ubicacion {self.nombre}>"


class Resguardante(Base):
    __tablename__ = "resguardantes"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(200), unique=True, nullable=False, index=True)

    activos = relationship("Activo", back_populates="resguardante")

    def __repr__(self):
        return f"<Resguardante {self.nombre}>"


class Activo(Base):
    __tablename__ = "activos"

    id = Column(Integer, primary_key=True, index=True)
    
    # Identificadores:
    # codigo_interno: Asignado a TODOS los activos para consistencia y unicidad local (ej. PL3-CEN-000242, PL3-GTO-0001, PL3-CA-0001)
    codigo_interno = Column(String(50), unique=True, nullable=False, index=True)
    # codigo_oficial: Número físico de la etiqueta verde de Bienes Patrimoniales (NULL si está pendiente)
    codigo_oficial = Column(String(50), unique=True, nullable=True, index=True)
    
    # Clasificación y Estatus
    origen = Column(String(30), nullable=False, index=True)  # 'GASTO', 'C.A.', 'CENTRAL', 'AUDITORIO'
    estatus_etiqueta = Column(String(30), default="PENDIENTE_ETIQUETA", nullable=False, index=True)  # 'PENDIENTE_ETIQUETA', 'ETIQUETADO_OFICIAL'
    estatus_activo = Column(String(50), default="ACTIVO", nullable=False)  # 'ACTIVO', 'BAJA', 'EN_REPARACION'
    
    # Datos físicos y técnicos del activo
    descripcion = Column(String(255), nullable=False, index=True)
    especificacion = Column(Text, nullable=True)
    marca = Column(String(100), nullable=True, index=True)
    modelo = Column(String(100), nullable=True)
    numero_serie = Column(String(100), nullable=True, index=True)
    
    # Relaciones / Catálogos
    categoria_id = Column(Integer, ForeignKey("categorias.id"), nullable=True)
    ubicacion_id = Column(Integer, ForeignKey("ubicaciones.id"), nullable=True, index=True)
    resguardante_id = Column(Integer, ForeignKey("resguardantes.id"), nullable=True)
    
    # Datos administrativos y financieros
    familia = Column(String(50), nullable=True)
    centro_costo = Column(String(100), default="PLANTEL 3", nullable=True)
    condicion = Column(String(100), nullable=True)
    costo = Column(Float, nullable=True)
    donacion_tipo = Column(String(100), nullable=True)
    orden_compra = Column(String(100), nullable=True)
    numero_factura = Column(String(100), nullable=True)
    fecha_recepcion = Column(Date, nullable=True)
    observaciones = Column(Text, nullable=True)
    archivo_fuente = Column(String(100), nullable=True)
    
    # Metadatos de auditoría
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relaciones ORM
    categoria = relationship("Categoria", back_populates="activos")
    ubicacion = relationship("Ubicacion", back_populates="activos")
    resguardante = relationship("Resguardante", back_populates="activos")
    historial_etiquetas = relationship("HistorialEtiqueta", back_populates="activo", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Activo {self.codigo_interno} - {self.descripcion[:30]}>"


class HistorialEtiqueta(Base):
    __tablename__ = "historial_etiquetas"

    id = Column(Integer, primary_key=True, index=True)
    activo_id = Column(Integer, ForeignKey("activos.id"), nullable=False)
    codigo_oficial_asignado = Column(String(50), nullable=False)
    asignado_por = Column(String(100), nullable=True)
    fecha_asignacion = Column(DateTime, server_default=func.now())
    notas = Column(Text, nullable=True)

    activo = relationship("Activo", back_populates="historial_etiquetas")

    def __repr__(self):
        return f"<HistorialEtiqueta Activo:{self.activo_id} -> {self.codigo_oficial_asignado}>"

