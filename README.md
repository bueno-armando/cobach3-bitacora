# Sistema de Inventario y Control de Activos — COBACH Plantel 3

Plataforma web integral de gestión, trazabilidad y control de inventario de bienes patrimoniales para el **Colegio de Bachilleres del Estado de Chihuahua (Plantel 3)**.

Desarrollada para resolver la brecha operativa entre la catalogación externa de la Dirección General de Bienes Patrimoniales (Oficina Central) y las adquisiciones locales del plantel.

---

## 🎯 Contexto del Problema y Solución

### El Reto
En la operación cotidiana del Plantel 3:
1. **Dependencia de Oficina Central:** El inventario oficial lo administra externamente la Dirección General mediante una plataforma legada poco accesible.
2. **El Limbo de la "Etiqueta Verde":** Cuando el plantel adquiere bienes con recursos propios (por vías de **GASTO** o **C.A.**), transcurren meses antes de que el personal central acuda físicamente a pegar la etiqueta verde con el "Código" oficial. Durante este lapso, el plantel carecía de un sistema para registrar, auditar y asignar resguardos de dichos equipos.
3. **Silos de Información en Excel:** La información se encontraba dispersa en 4 archivos de hojas de cálculo desconectadas entre sí (1,406 activos en total).

### La Solución Técnica
* **Modelo Relacional Unificado:** Consolidación de los archivos Excel dispersos en una base de datos relacional (SQLite / PostgreSQL) con catálogos normalizados en 3FN (Ubicaciones, Categorías, Resguardantes).
* **Ciclo de Vida de Doble Identificador:**
  * `codigo_interno`: Identificador único y atómico asignado de inmediato al ingresar el activo al plantel (`PL3-GTO-XXXX`, `PL3-CA-XXXX`, `PL3-CEN-XXXXXX`, `PL3-AUD-XXXXXX`).
  * `codigo_oficial`: Número de la etiqueta verde oficial, el cual permanece pendiente (`NULL`) hasta su colocación física.
* **Módulo de Conciliación de Etiquetas:** Permite al encargado de informática buscar cualquier activo provisional y registrar en segundos el código oficial de la etiqueta verde tan pronto como la Oficina Central la instala, manteniendo una bitácora histórica inmutable de auditoría (`historial_etiquetas`).
* **Control de Estado Físico / Operativo:** Registro y filtrado de bienes **Operativos**, **En Desuso (propuestos para baja/descarte)**, **En Reparación** o **Bajas Oficiales**.
* **Impresión de Etiquetas en Hoja Carta (10 por Hoja / 2x5):**
  * Generación al vuelo en el cliente de **Código de Barras (CODE128)**, **Código QR** o **Ambos Códigos emparejados** con el logo institucional del Halcón Plantel 3.
  * Selector dinámico de codificación: **Código Interno (PL3-...)** o **Código Oficial (Verde)**.
  * Líneas de corte configurables: continuas, punteadas o sin líneas (para hojas autoadhesivas troqueladas comerciales estándar tipo **Avery 5163 / 5263**).
  * Esquinas cuadradas de 90° optimizadas para corte manual con guillotina o tijeras.
  * Función *"Llenar hoja (10)"* para generar plantillas completas de un activo en un solo clic.
* **Cola de Impresión Acumulativa (Print Queue):** Permite agregar activos de distintas ubicaciones o búsquedas, ajustar copias individuales y mandarlos a la hoja de impresión o exportar la lista a Excel.
* **Acciones en Lote (Bulk Actions):** Casillas de selección múltiple con barra flotante para agregar elementos masivamente a la cola o imprimirlos en bloque.
* **Exportación Institucional a Excel (.xlsx):** Generación nativa en streaming de reportes con filtros activos, inventario completo o cola de impresión, con estilos y autofiltros.
* **Búsqueda en Tiempo Real con Debounce:** Filtrado instantáneo a 280 ms sin necesidad de botones de recarga.
* **Gestión CRUD Completa:** Registro, edición, baja y consulta detallada de cualquier activo.

---

## 🛠️ Stack Tecnológico y Portabilidad

* **Backend:** Python 3.10+ / **FastAPI** (asíncrono, tipado estricto con Pydantic, documentación Swagger interactiva).
* **ORM & Base de Datos:** **SQLAlchemy 2.0** con motor relacional **SQLite** (cero configuración, portabilidad total en un único archivo `inventario.db`; compatible con PostgreSQL/MySQL mediante `DATABASE_URL`).
* **ETL & Data Processing:** **Pandas**, **OpenPyXL**, **LXML**.
* **Frontend:** HTML5 semántico, **Tailwind CSS**, FontAwesome, **JsBarcode** (Code 128), **QRCode.js**, **SheetJS** (XLSX), Vanilla JS modular moderno.
* **Operación 100% Offline:** Todas las librerías de estilos, iconos, generadores de códigos y exportadores están empaquetadas localmente, sin dependencia de internet.
* **Multiplataforma:** Diseñado para desarrollarse en **Linux (Arch Linux)** y desplegarse en servidores o PCs con **Windows / Windows Server**.

---

## 🗄️ Modelo de Datos Relacional

```mermaid
erDiagram
    ACTIVOS }|--|| CATEGORIAS : "categorizado en"
    ACTIVOS }|--|| UBICACIONES : "ubicado en"
    ACTIVOS }|--|| RESGUARDANTES : "a cargo de"
    ACTIVOS ||--o{ HISTORIAL_ETIQUETAS : "auditoría de etiquetas"

    ACTIVOS {
        int id PK
        string codigo_interno UK "PL3-GTO-0001 / PL3-CEN-000242"
        string codigo_oficial UK "Etiqueta verde oficial (nullable)"
        string origen "GASTO, C.A., CENTRAL, AUDITORIO"
        string estatus_etiqueta "PENDIENTE_ETIQUETA, ETIQUETADO_OFICIAL"
        string estatus_activo "OPERATIVO, EN_DESUSO, EN_REPARACION, BAJA"
        string descripcion
        string marca
        string modelo
        string numero_serie "Identificador físico de fábrica"
        int ubicacion_id FK
        int categoria_id FK
        int resguardante_id FK
    }

    HISTORIAL_ETIQUETAS {
        int id PK
        int activo_id FK
        string codigo_oficial_asignado
        string asignado_por
        datetime fecha_asignacion
        string notas
    }
```

---

## 🚀 Instalación y Puesta en Marcha

### En Linux (Arch Linux, Ubuntu, Debian, etc.)

```bash
# 1. Clonar el repositorio
git clone git@github.com:bueno-armando/cobach3-bitacora.git
cd cobach3-bitacora

# 2. Iniciar con el script automatizado (crea .venv, instala dependencias y levanta el servidor)
./run.sh
```

O manualmente:
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

El sistema estará disponible en:
* Interfaz Web: **`http://localhost:8000`**
* Documentación Swagger API: **`http://localhost:8000/docs`**

---

### En Windows (Scripts Automatizados)

El repositorio incluye automatizaciones completas para entornos Windows:

1. **Instalación Inicial:**  
   Haz doble clic en **`instalar_windows.bat`**. Creará el entorno virtual `.venv`, instalará los paquetes y preparará la base de datos automáticamente.
2. **Uso Diario:**  
   Haz doble clic en **`iniciar_sistema.bat`**. Levantará el servidor escuchando en la red local (`0.0.0.0:8000`) y **abrirá automáticamente el navegador web**.

*(Para una guía detallada sobre cómo abrir puertos en el Firewall de Windows, acceder desde otras computadoras de la red del plantel o configurar el inicio automático como servicio, consulta el manual interno `MANUAL_WINDOWS.md`).*

---

## 🔒 Privacidad de Datos y Demostración

Por razones de confidencialidad institucional y cumplimiento normativo de protección de datos personales, los archivos Excel con datos reales y la base de datos de producción están excluidos de este repositorio mediante `.gitignore`.

Para probar el sistema con datos de demostración realistas (computadoras, proyectores, pizarrones y mobiliario ficticio):

```bash
python scripts/seed_sample_data.py
```
Esto generará una base de datos `inventario.db` lista para interactuar con la plataforma.

---

## 📋 Endpoints Principales de la API

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/activos` | Consulta paginada con filtros por texto, origen (`GASTO`, `C.A.`), ubicación, categoría y estado físico |
| `POST` | `/api/activos` | Crear un nuevo activo en el inventario (autogenera código interno) |
| `GET` | `/api/activos/{id}` | Ficha técnica y administrativa completa de un activo con su historial de etiquetas |
| `PUT` | `/api/activos/{id}` | Modificar datos técnicos o administrativos del activo |
| `DELETE` | `/api/activos/{id}` | Eliminar un activo del sistema |
| `PATCH` | `/api/activos/{id}/estatus-operativo` | Actualizar estado físico (`OPERATIVO`, `EN_DESUSO`, `EN_REPARACION`, `BAJA`) |
| `POST` | `/api/activos/{id}/asignar-etiqueta` | Conciliación y asignación de etiqueta verde oficial con validación de unicidad |
| `GET` | `/api/exportar/excel` | Exportación en streaming de activos a formato institucional Excel (`.xlsx`) |
| `GET` | `/api/catalogos` | Listado de ubicaciones, categorías y resguardantes normalizados |
| `GET` | `/api/stats` | Indicadores clave (total activos, oficiales vs. pendientes por origen y estado) |

---

## 📖 Documentación de Contexto Técnico
Para detalles técnicos exhaustivos sobre reglas de negocio, decisiones arquitectónicas y guías de desarrollo, consulta el archivo [**`CONTEXT.md`**](file:///home/senorbuen0/ISC/sem9/cobach3-bitacora/CONTEXT.md).

---

## 👤 Autor
Desarrollado como solución tecnológica para el **Colegio de Bachilleres del Estado de Chihuahua — Plantel 3**.
