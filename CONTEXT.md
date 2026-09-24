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

* **Archivo de base de datos:** `inventario.db` (en raíz del proyecto; versionado mediante `!inventario.db` en `.gitignore` para contener de forma inmediata los 1,406 registros en despliegues como Railway).
* **ORM:** SQLAlchemy 2.0 (`backend/database.py`, `backend/models.py`).

### Esquema Relacional:
```
usuarios:
  - id (INTEGER PK AUTOINCREMENT)
  - username (VARCHAR(50) UNIQUE NOT NULL)
  - nombre_completo (VARCHAR(150) NOT NULL)
  - password_hash (VARCHAR(255) NOT NULL)
  - rol (VARCHAR(30) NOT NULL: 'admin', 'resguardo', 'consulta')
  - activo (BOOLEAN DEFAULT TRUE)
  - created_at, updated_at (TIMESTAMP)

ubicaciones (id, nombre)
categorias (id, nombre)
resguardantes (id, nombre)

activos:
  - id (INTEGER PK AUTOINCREMENT)
  - codigo_interno (VARCHAR(50) UNIQUE NOT NULL)
  - codigo_oficial (VARCHAR(50) UNIQUE NULL)
  - origen (VARCHAR(30) NOT NULL: 'GASTO', 'CONTROL ADMINISTRATIVO', 'DIRECCION GENERAL')
  - estatus_etiqueta (VARCHAR(30): 'PENDIENTE_ETIQUETA', 'ETIQUETADO_OFICIAL')
  - estatus_activo (VARCHAR(50): 'OPERATIVO', 'EN_DESUSO', 'EN_REPARACION', 'BAJA')
  - condicion_dg (VARCHAR(100) NULL: Condición inicial de Dirección General)
  - condicion_actual (VARCHAR(100) DEFAULT 'Buena 61% - 80%': Condición física modificable localmente)
  - imagen_url (VARCHAR(255) NULL: Ruta local de fotografía en /uploads)
  - es_foto_personalizada (BOOLEAN DEFAULT FALSE: Protege fotos de daños específicos al propagar por modelo)
  - descripcion (VARCHAR(255) NOT NULL)
  - especificacion (TEXT)
  - marca (VARCHAR(100))
  - modelo (VARCHAR(100))
  - numero_serie (VARCHAR(100))
  - categoria_id (FK -> categorias.id)
  - ubicacion_id (FK -> ubicaciones.id)
  - resguardante_id (FK -> resguardantes.id)
  - centro_costo (VARCHAR(100) DEFAULT 'PLANTEL 3')
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

## 5. Sistema de Roles, Autenticación y Control de Accesos (RBAC)

El sistema incorpora control de acceso basado en roles para desacoplar el uso administrativo de la operación docente y la simple consulta auditora:

### Matriz de Roles y Alcance:
| Rol | Usuarios Objetivo | Permisos Principales | Restricciones de Seguridad |
|---|---|---|---|
| **`admin`** | Encargado de Sistemas y Dirección | **Control total**: Altas de bienes, edición completa de cualquier campo, bajas definitivas (`DELETE`), asignación de etiqueta verde oficial, gestión de fotos, exportación e impresión. | Sin restricciones. |
| **`resguardo`** | Personal (Resguardantes de Aulas / Oficinas / Laboratorios) | **Operación y sustento técnico**: Consultar inventario, **dar de alta nuevos bienes** (con folio consecutivo autogenerado), **marcar activos en desuso o reparación**, actualizar condición física con justificación técnica (`PATCH /api/activos/{id}/condicion`) y subir fotos de evidencia/daños. | Restringido de borrado permanente (`DELETE`) y de asignar etiqueta verde oficial. |
| **`consulta`** | Consulta y Auditoría Institucional | **Solo Lectura**: Búsqueda, filtros por condición/ubicación/categoría, visualización de fichas técnicas completas, exportación dinámica a Excel y cola de impresión. | Restringido de altas, ediciones, bajas, cambios de estatus y subida de archivos. |

### Cuentas Sembradas por Defecto:
Para eliminar la fricción burocrática de crear cuentas individuales por cada docente, se inicializan automáticamente 3 cuentas institucionales compartidas al arrancar la aplicación (`seed_default_users`):
* `admin` / `Cobach3#Admin`
* `resguardo` / `Cobach3#Resguardo`
* `consulta` / `Cobach3#Consulta`

### Seguridad Criptográfica:
* **Hashing de Contraseñas:** PBKDF2-HMAC-SHA256 con 100,000 iteraciones y salt criptográfico de 16 bytes (módulo nativo estándar `hashlib` y `secrets`, garantizando cero dependencias binarias problemáticas en compilaciones Linux/Windows/Nixpacks).
* **Tokens de Acceso:** JWT con algoritmo HS256, expiración de 7 días y extracción mediante dependencias FastAPI (`get_current_user`, `require_roles`, `require_roles_flexible`).

---

## 6. API Backend (FastAPI)

Ubicación del código: [`backend/main.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/backend/main.py), [`backend/crud.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/backend/crud.py) y [`backend/auth.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/backend/auth.py).

### Endpoints REST:
* **Autenticación y Sesión:**
  * `POST /api/auth/login`: Autentica credenciales y emite token JWT con datos del usuario.
  * `GET /api/auth/me`: Retorna los datos y rol del usuario autenticado en la sesión actual.
* **Gestión de Bienes Muebles:**
  * `GET /api/activos`: Consulta paginada con filtros combinables (`q`, `origen`, `ubicacion_id`, `categoria_id`, `resguardante_id`, `estatus_etiqueta`, `estatus_activo`, `condicion`, `page`, `limit`).
  * `POST /api/activos`: Registrar un nuevo activo (autogenera código interno protegido según procedencia; accesible para `admin` y `resguardo`).
  * `GET /api/activos/{id}`: Detalle completo de un activo con relaciones, historial de etiquetas y fotografía.
  * `PUT /api/activos/{id}`: Modificación completa de datos técnicos/administrativos (exclusivo `admin`).
  * `DELETE /api/activos/{id}`: Eliminación física del activo (exclusivo `admin`).
  * `PATCH /api/activos/{id}/condicion`: Actualizar condición física (`Excelente`, `Buena`, `Mala`, `Pésima`), estatus operativo (`ACTIVO`, `EN_DESUSO`, `EN_REPARACION`) y observaciones técnicas (para `admin` y `resguardo`).
  * `PATCH /api/activos/{id}/estatus-operativo`: Cambio rápido de estado operativo.
  * `POST /api/activos/{id}/asignar-etiqueta`: Asignación oficial de etiqueta verde patrimonial (exclusivo `admin`).
  * `POST /api/activos/{id}/imagen`: Subida de fotografía con opción de propagación a modelo y protección de fotos particulares.
  * `DELETE /api/activos/{id}/imagen`: Eliminación de fotografía asociada (exclusivo `admin`).
* **Catálogos y Reportes:**
  * `GET /api/catalogos`: Retorna listas normalizadas de ubicaciones, categorías y resguardantes.
  * `GET /api/stats`: Métricas generales del inventario (totales, oficiales, pendientes, etc.).
  * `GET /api/export/excel`: Exportación en streaming a `.xlsx` admitiendo parámetros `columnas` (selección dinámica de 18 columnas), `condicion`, filtros de búsqueda y token Bearer flexible.

---

## 7. Frontend Web (SPA ligera)

Ubicación del código: [`frontend/index.html`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/frontend/index.html) y [`frontend/app.js`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/frontend/app.js).
* **Tecnologías:** HTML5, Tailwind CSS, FontAwesome 6, JsBarcode (Code 128), QRCode.js.
* **Arquitectura de Interfaz:**
  * **Panel Superior (Header) en 2 Niveles Alineados:**
    * **Lado Izquierdo:**
      * Nivel 1: Logotipo oficial del Halcón y título institucional **"Bienes Muebles COBACH Plantel 3"** [Chihuahua].
      * Nivel 2: Cápsula de perfil del usuario (`#user-profile-capsule`) directamente debajo del título, mostrando el badge de rol (`ADMIN`, `RESGUARDO`, `CONSULTA`), el nombre completo institucional íntegro sin recortar (`whitespace-nowrap`) y el botón de salida.
    * **Lado Derecho:**
      * Nivel 1: Indicador de métricas rápidas (Total, Oficiales, Pendientes).
      * Nivel 2: Botones de acción alineados debajo de las métricas: **"+ Nuevo"** (oculto para `consulta`), **"Cola"** e **"Exportar"**.
  * **Barra de Búsqueda y Filtro de Condición:**
    * Campo de búsqueda rápida con debounce de 280 ms.
    * Selectores instantáneos por **Ubicación Física**, **Categoría** y **Condición Física** (`Excelente`, `Buena`, `Mala`, `Pésima`).
  * **Pestañas Patrimoniales:**
    * `Todos`, `Gasto ($1 - $3,000)`, `Control Admin ($3,001 - $7,900)`, `Código Etiqueta (D.G)` y `Pendientes Etiqueta`.
  * **Modales y Flujos Clave:**
    * **Modal de Login:** Con branding institucional, toggle de contraseña y 3 botones de "Acceso Rápido" en un clic (`Consulta`, `Resguardo`, `Admin`).
    * **Modal de Condición / Desuso para Personal:** Permite reportar deterioro, cambiar estado a `EN_DESUSO` o `EN_REPARACION`, registrar justificación técnica y saltar a la captura de fotografía de daño.
    * **Modal de Exportación Dinámica a Excel:** Permite seleccionar de forma granular hasta 18 columnas mediante casillas de verificación, con botones de control rápido ("Todas", "Predeterminadas", "Ninguna") y descarga autenticada vía Blob.
    * **Modal de Impresión y Cola:** 10 etiquetas por hoja Carta (cuadrícula 2x5, 48 mm de alto) para papel normal o planillas Avery 5163 / Janel.

---

## 8. Despliegue en Producción (Railway)

* **Plataforma:** Railway con compilación automática mediante Nixpacks.
* **Archivos de Configuración:**
  * [`railway.toml`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/railway.toml): Define el constructor `NIXPACKS` y comando `uvicorn main:app --host 0.0.0.0 --port $PORT`.
  * [`Procfile`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/Procfile): `web: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}`.
  * [`main.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/main.py): Punto de entrada raíz que vincula el puerto dinámico asignado por Railway.
* **URL de Producción:** **`https://optimistic-surprise-production-137a.up.railway.app`**

---

## 9. Ejecución Local y Portabilidad Linux / Windows

* **Linux (Arch Linux / Ubuntu / Debian):**
  ```bash
  ./run.sh
  ```
* **Windows (Doble clic):**
  ```cmd
  iniciar.bat
  ```
  Crea automáticamente el `.venv` en Windows si no existe, instala `requirements.txt` y abre el navegador en `http://localhost:8000`.

---

## 10. Pruebas Automatizadas y Calidad

El proyecto incluye 3 suites de pruebas automatizadas con pytest:
* [`tests/test_auth_and_roles.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/tests/test_auth_and_roles.py): Siembra de usuarios, login, emisión de JWT y verificación estricta de permisos RBAC (401, 403, 201).
* [`tests/test_bloque1_and_2.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/tests/test_bloque1_and_2.py): Consecutivos automáticos protegidos, exportación selectiva de columnas a Excel y filtrado por condición física.
* [`tests/test_photo_and_condition.py`](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/tests/test_photo_and_condition.py): Subida y propagación de fotos, blindaje de campos y fichas técnicas.
* **Regla estricta de aislamiento:** Todas las pruebas ejecutan limpieza incondicional en bloques `finally`, garantizando que la base de datos de producción conserve exactamente los 1,406 activos reales sin contaminación de pruebas.

