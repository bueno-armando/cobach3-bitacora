# CONTEXT.md — Contexto Técnico y Arquitectura del Sistema
> **Propósito de este documento:** Este archivo contiene el contexto integral, decisiones arquitectónicas, reglas de negocio y modelo de datos del proyecto para ser consumido por desarrolladores, colaboradores o modelos de IA en futuras sesiones de trabajo. Debe mantenerse actualizado ante cualquier cambio estructural.

---

## 1. Información General del Proyecto
* **Proyecto:** Sistema de Consulta, Control y Trazabilidad de Inventario de Activos.
* **Institución:** Colegio de Bachilleres del Estado de Chihuahua (COBACH) — **Plantel 3** (Chihuahua, Chih.).
* **Usuario Clave / Stakeholder:** Encargado del Departamento de Informática del Plantel 3.
* **Entidad Central Externa:** Dirección General de Colegios de Bachilleres / Departamento de Bienes Patrimoniales (Oficina Central).

---

## 2. El Problema de Negocio y Reglas del Dominio

### A. La Brecha Operativa con Oficina Central
1. **Control Centralizado:** La Oficina Central maneja la plataforma oficial de inventario de todos los planteles del estado. El Plantel 3 no tiene control directo de escritura sobre dicha plataforma.
2. **El Cuello de Botella de la "Etiqueta Verde":**
   * Cuando el Plantel 3 adquiere o recibe un bien localmente, transcurren meses (e incluso años) hasta que personal de Bienes Patrimoniales acude físicamente al plantel a colocar la **etiqueta verde** adhesiva con el **"Código" oficial** de inventario.
   * Durante ese tiempo de espera, el bien se encontraba en un "limbo": sin código oficial, sin posibilidad de ser consultado en la plataforma central y gestionado únicamente en hojas de Excel dispersas.
3. **Canales de Adquisición Local:**
   * **GASTO (GTO):** Bienes adquiridos mediante presupuesto operativo o gasto corriente del plantel.
   * **C.A.:** Bienes adquiridos mediante recursos locales de comités/aportaciones del plantel.

### B. Solución: Ciclo de Vida con Doble Identificador
* **`codigo_interno` (Obligatorio, Atómico, Inmediato):**
  * Asignado en el momento en que el activo ingresa al plantel.
  * Formatos estandarizados:
    * Gasto: `PL3-GTO-XXXX` (ej. `PL3-GTO-0001`)
    * C.A.: `PL3-CA-XXXX` (ej. `PL3-CA-0001`)
    * Oficina Central: `PL3-CEN-XXXXXX` (ej. `PL3-CEN-000242`)
    * Auditorio: `PL3-AUD-XXXXXX` (ej. `PL3-AUD-024753`)
  * Permite imprimir etiquetas locales temporales con código QR y logo del plantel.
* **`codigo_oficial` (Nullable / Diferido):**
  * Es el número físico de la etiqueta verde colocada por Bienes Patrimoniales.
  * Para activos de GTO y C.A., inicia como `NULL` (`estatus_etiqueta = 'PENDIENTE_ETIQUETA'`).
* **Módulo de Conciliación:**
  * Cuando Bienes Patrimoniales coloca la etiqueta verde, el encargado busca el activo (por serie, descripción o código interno) y registra el número oficial. El sistema valida unicidad, pasa el estado a `'ETIQUETADO_OFICIAL'` y guarda un registro en `historial_etiquetas`.

### C. Estados de los Activos (Dos Dimensiones Independientes)
1. **Estado de Etiquetado (`estatus_etiqueta`):**
   * `PENDIENTE_ETIQUETA`: Sin etiqueta verde oficial.
   * `ETIQUETADO_OFICIAL`: Con etiqueta verde oficial verificada.
2. **Estado Físico / Operativo (`estatus_activo`):**
   * `OPERATIVO` (o `ACTIVO`): El bien está en uso funcional.
   * `EN_DESUSO`: El bien está arrumbado, obsoleto o apartado para propuesta de descarte/baja.
   * `EN_REPARACION`: En mantenimiento técnico.
   * `BAJA`: Bien desincorporado oficialmente.

---

## 3. Fuentes de Datos Originales y Migración ETL

El sistema consolida 4 archivos que se encontraban desconectados en la raíz del proyecto:
1. `Inventario_060926.xls`: Exportación HTML del sistema de Oficina Central (1,124 filas, 21 columnas). Todos tienen etiqueta verde oficial.
2. `GTO PL 3.xlsx`: 126 registros de compras por Gasto del Plantel 3. Código oficial = `N/A`.
3. `C.A. PL 3.xlsx`: 56 registros de compras por C.A. del Plantel 3. Código oficial = `N/A`.
4. `ARCHIVO PL3 SISTEMA.xlsx`: 100 butacas de auditorio con códigos ya generados (6836, 24753...24851).

* **Total de activos iniciales:** **1,406 registros**.
* **Script de migración:** [`scripts/migrate_excels.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/scripts/migrate_excels.py). Normaliza cadenas, elimina 'N/A', consolida acentos de resguardantes (Dr. Edgar Álvarez Castillo) y genera los catálogos relacionales.

---

## 4. Arquitectura de Base de Datos (SQLite + SQLAlchemy)

* **Archivo de base de datos:** `inventario.db` (en raíz del proyecto, excluido de Git por `.gitignore`).
* **ORM:** SQLAlchemy 2.0 (`backend/database.py`, `backend/models.py`).

### Esquema Relacional:
```
ubicaciones (id, nombre)
categorias (id, nombre)
resguardantes (id, nombre)

activos:
  - id (INTEGER PK AUTOINCREMENT)
  - codigo_interno (VARCHAR(50) UNIQUE NOT NULL)
  - codigo_oficial (VARCHAR(50) UNIQUE NULL)
  - origen (VARCHAR(30) NOT NULL: 'GASTO', 'C.A.', 'CENTRAL', 'AUDITORIO')
  - estatus_etiqueta (VARCHAR(30): 'PENDIENTE_ETIQUETA', 'ETIQUETADO_OFICIAL')
  - estatus_activo (VARCHAR(50): 'OPERATIVO', 'EN_DESUSO', 'EN_REPARACION', 'BAJA')
  - descripcion (VARCHAR(255) NOT NULL)
  - especificacion (TEXT)
  - marca (VARCHAR(100))
  - modelo (VARCHAR(100))
  - numero_serie (VARCHAR(100))
  - categoria_id (FK -> categorias.id)
  - ubicacion_id (FK -> ubicaciones.id)
  - resguardante_id (FK -> resguardantes.id)
  - centro_costo (VARCHAR(100) DEFAULT 'PLANTEL 3')
  - condicion (VARCHAR(100))
  - costo (FLOAT)
  - donacion_tipo (VARCHAR(100))
  - orden_compra (VARCHAR(100))
  - numero_factura (VARCHAR(100))
  - fecha_recepcion (DATE)
  - observaciones (TEXT)
  - archivo_fuente (VARCHAR(100))
  - created_at, updated_at (TIMESTAMP)

historial_etiquetas:
  - id (INTEGER PK)
  - activo_id (FK -> activos.id)
  - codigo_oficial_asignado (VARCHAR(50))
  - asignado_por (VARCHAR(100))
  - fecha_asignacion (TIMESTAMP)
  - notas (TEXT)
```

---

## 5. API Backend (FastAPI)

Ubicación del código: [`backend/main.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/backend/main.py) y [`backend/crud.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/backend/crud.py).

### Endpoints REST:
* `GET /api/activos`: Búsqueda con filtros combinables (`q`, `origen`, `ubicacion_id`, `categoria_id`, `resguardante_id`, `estatus_etiqueta`, `estatus_activo`, `page`, `limit`).
  * `q` busca simultáneamente en código oficial, código interno, número de serie, descripción, marca, modelo, especificaciones, ubicación, categoría y resguardante.
* `POST /api/activos`: Registrar un nuevo activo (autogenera código interno si no se envía).
* `GET /api/activos/{id}`: Detalle completo de un activo con relaciones e historial.
* `PUT /api/activos/{id}`: Modificación completa de cualquier campo del activo.
* `DELETE /api/activos/{id}`: Eliminación de un activo.
* `PATCH /api/activos/{id}/estatus-operativo`: Cambio rápido de estado físico (`OPERATIVO`, `EN_DESUSO`, `EN_REPARACION`, `BAJA`) con motivo opcional.
* `POST /api/activos/{id}/asignar-etiqueta`: Conciliación de etiqueta verde.
* `GET /api/catalogos`: Retorna todas las ubicaciones, categorías y resguardantes.
* `GET /api/stats`: Métricas de activos (totales, por origen, oficiales vs pendientes, operativos vs en desuso).

---

## 6. Frontend Web (SPA ligera)

Ubicación del código: [`frontend/index.html`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/frontend/index.html) y [`frontend/app.js`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/frontend/app.js).
* **Tecnologías:** HTML5, Tailwind CSS (CDN), FontAwesome 6, QRCode.js.
* **Activos Gráficos:**
  * `frontend/assets/logo_plantel3_halcon_cuerpo_completo.png`: Mascota Halcón oficial del Plantel 3.
  * `frontend/assets/Logotipo_COBACH.png`: Logotipo general institucional del COBACH.
* **Características de la UI:**
  * **Encabezado sólido:** `bg-[#064e3b]`, 100% opaco para evitar traslapes visuales durante el scroll.
  * **Pestañas:** Todos, GASTO (GTO), C.A., Pendientes de Etiqueta Verde, Oficina Central.
  * **Buscador:** Búsqueda en vivo y filtros por Ubicación Física, Categoría y Estado Físico.
  * **CRUD Modals:**
    * Modal `+ Nuevo Activo` con autocompletado en datalists.
    * Modal `Editar Activo`.
    * Modal `Eliminar Activo` con confirmación.
    * Modal `Detalle del Activo`.
    * Modal `Imprimir Etiquetas & Cola de Impresión`: Sistema híbrido que combina selección en tabla (con botón para seleccionar todo el filtro actual de hasta 2,500 ítems) y una Cola de Impresión persistente en `localStorage`. Genera hojas de 10 etiquetas por hoja Carta (cuadrícula 2x5, estándar 48 mm de alto) tanto para hojas normales de papel bond (con guías de corte sólidas o punteadas para tijera/guillotina) como para planillas autoadhesivas precortadas (Avery 5163 / Janel). Diseño maximizado con Mascota Halcón y Código lado a lado a ~35mm de altura (80% del área útil) e información en la base. 100% offline.

---

## 7. Ejecución y Portabilidad Linux / Windows

* **Linux (Arch Linux):**
  ```bash
  ./run.sh
  ```
* **Windows (Doble clic):**
  ```cmd
  iniciar.bat
  ```
  Crea automáticamente el `.venv` en Windows si no existe, instala `requirements.txt` y abre el navegador en `http://localhost:8000`.

---

## 8. Seguridad y Portafolio en GitHub
* Los archivos Excel reales (`*.xls`, `*.xlsx`) y la base de datos real (`*.db`) están en `.gitignore` para cumplir con normativas de protección de datos.
* Para demostración pública o pruebas de reclutadores, se incluye:
  ```bash
  python scripts/seed_sample_data.py
  ```
  que crea una base de datos de prueba con registros ficticios.

