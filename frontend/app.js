// Estado global de la aplicación
const state = {
  user: null, // Objeto Usuario de la sesión actual ({ id, username, nombre_completo, rol, activo })
  tab: '', // '' (Todos), 'GASTO', 'C.A.', 'PENDIENTES', 'CENTRAL'
  q: '',
  ubicacion_id: '',
  categoria_id: '',
  estatus_activo: '',
  page: 1,
  limit: 50,
  totalPages: 1,
  totalItems: 0,
  deletingId: null,
  rawCatalogos: { ubicaciones: [], categorias: [], resguardantes: [] },
  selectedIds: new Set(),
  printQueue: new Map(), // ID -> { activo, copies }
  borderStyle: 'solid',  // 'solid', 'dashed', 'none'
  basePrintItems: [],
  printCopies: 1,
  currentPrintItems: []  // Lista de activos expandida para la hoja de etiquetas
};

// ==========================================
// AUTENTICACIÓN Y ROLES
// ==========================================
const TOKEN_KEY = 'cobach3_jwt';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  options.headers = headers;

  const res = await fetch(url, options);
  if (res.status === 401) {
    setToken(null);
    state.user = null;
    openLoginModal();
    throw new Error('Sesión no autorizada o expirada');
  }
  return res;
}

function openLoginModal() {
  const modal = document.getElementById('modal-login');
  if (modal) {
    modal.classList.remove('hidden');
    document.getElementById('login-error')?.classList.add('hidden');
  }
}

function closeLoginModal() {
  const modal = document.getElementById('modal-login');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function togglePasswordVisibility() {
  const pwdInput = document.getElementById('login-password');
  const icon = document.getElementById('password-toggle-icon');
  if (!pwdInput) return;
  if (pwdInput.type === 'password') {
    pwdInput.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    pwdInput.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

async function submitLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorDiv = document.getElementById('login-error');
  const errorMsg = document.getElementById('login-error-msg');
  const btnSubmit = document.getElementById('btn-login-submit');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    errorDiv.classList.remove('hidden');
    errorMsg.textContent = 'Por favor ingresa usuario y contraseña.';
    return;
  }

  errorDiv.classList.add('hidden');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Verificando...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Credenciales incorrectas');
    }

    const data = await res.json();
    setToken(data.access_token);
    state.user = data.user;

    closeLoginModal();
    applyRolePermissionsUI();
    showToast(`Bienvenido, ${data.user.nombre_completo || data.user.username}`);

    await initApp();
  } catch (err) {
    errorDiv.classList.remove('hidden');
    errorMsg.textContent = err.message || 'Error de conexión o credenciales incorrectas';
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Iniciar Sesión';
  }
}

function quickLogin(rol) {
  const credentials = {
    admin: { user: 'admin', pass: 'Cobach3#Admin' },
    resguardo: { user: 'resguardo', pass: 'Cobach3#Resguardo' },
    consulta: { user: 'consulta', pass: 'Cobach3#Consulta' }
  };
  const cred = credentials[rol];
  if (!cred) return;
  document.getElementById('login-username').value = cred.user;
  document.getElementById('login-password').value = cred.pass;
  submitLogin();
}

function logout() {
  setToken(null);
  state.user = null;
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('user-profile-capsule')?.classList.add('hidden');
  openLoginModal();
  showToast('Has cerrado sesión correctamente');
}

function applyRolePermissionsUI() {
  const user = state.user;
  if (!user) {
    document.getElementById('user-profile-capsule')?.classList.add('hidden');
    return;
  }

  // Actualizar cápsula de perfil en cabecera
  const capsule = document.getElementById('user-profile-capsule');
  const roleBadge = document.getElementById('user-role-badge');
  const nameDisplay = document.getElementById('user-name-display');

  if (capsule && roleBadge && nameDisplay) {
    capsule.classList.remove('hidden');
    nameDisplay.textContent = user.nombre_completo || user.username;

    if (user.rol === 'admin') {
      roleBadge.textContent = 'ADMIN';
      roleBadge.className = 'px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-xs bg-emerald-700 text-emerald-100 border border-emerald-600 whitespace-nowrap';
    } else if (user.rol === 'resguardo') {
      roleBadge.textContent = 'RESGUARDO';
      roleBadge.className = 'px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-xs bg-blue-700 text-blue-100 border border-blue-600 whitespace-nowrap';
    } else {
      roleBadge.textContent = 'CONSULTA';
      roleBadge.className = 'px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-xs bg-purple-700 text-purple-100 border border-purple-600 whitespace-nowrap';
    }
  }

  // Botón Nuevo Activo: visible para Admin y Resguardo, oculto para Consulta
  const btnNuevo = document.getElementById('btn-nuevo-activo');
  if (btnNuevo) {
    if (user.rol === 'consulta') {
      btnNuevo.classList.add('hidden');
    } else {
      btnNuevo.classList.remove('hidden');
    }
  }
}

async function checkSession() {
  const token = getToken();
  if (!token) {
    openLoginModal();
    return false;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      setToken(null);
      state.user = null;
      openLoginModal();
      return false;
    }
    const user = await res.json();
    state.user = user;
    applyRolePermissionsUI();
    closeLoginModal();
    return true;
  } catch (err) {
    setToken(null);
    state.user = null;
    openLoginModal();
    return false;
  }
}

async function initApp() {
  await Promise.all([
    loadStats(),
    loadCatalogos()
  ]);
  await loadActivos();
}

// Inicialización de la aplicación
document.addEventListener('DOMContentLoaded', async () => {
  loadQueueFromStorage();
  const isAuthenticated = await checkSession();
  if (isAuthenticated) {
    await initApp();
  }
});

// Cargar estadísticas KPI
async function loadStats() {
  try {
    const res = await authFetch('/api/stats');
    if (!res.ok) return;
    const stats = await res.json();
    document.getElementById('stat-total').textContent = stats.total_activos.toLocaleString();
    document.getElementById('stat-oficial').textContent = stats.total_etiquetados.toLocaleString();
    document.getElementById('stat-pendientes').textContent = stats.total_pendientes.toLocaleString();
  } catch (err) {
    console.error('Error cargando stats:', err);
  }
}

// Cargar catálogos y rellenar selects y datalists
async function loadCatalogos() {
  try {
    const res = await authFetch('/api/catalogos');
    if (!res.ok) return;
    const data = await res.json();
    state.rawCatalogos = data;

    const selectUbi = document.getElementById('filter-ubicacion');
    selectUbi.innerHTML = '<option value="">Todas las ubicaciones</option>';
    data.ubicaciones.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.nombre;
      selectUbi.appendChild(opt);
    });

    const selectCat = document.getElementById('filter-categoria');
    selectCat.innerHTML = '<option value="">Todas las categorías</option>';
    data.categorias.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre;
      selectCat.appendChild(opt);
    });

    populateDatalist('datalist-ubicaciones', data.ubicaciones);
    populateDatalist('datalist-categorias', data.categorias);
    populateDatalist('datalist-resguardantes', data.resguardantes);
  } catch (err) {
    console.error('Error cargando catálogos:', err);
  }
}

function populateDatalist(elementId, items) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = '';
  items.forEach(it => {
    const opt = document.createElement('option');
    opt.value = it.nombre;
    el.appendChild(opt);
  });
}

// Cargar lista de activos
async function loadActivos() {
  const tbody = document.getElementById('activos-table-body');
  tbody.innerHTML = `
    <tr>
      <td colspan="10" class="py-12 text-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-emerald-600"></i>
        <p>Consultando base de datos de activos...</p>
      </td>
    </tr>
  `;

  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit
  });

  if (state.q.trim()) params.append('q', state.q.trim());
  if (state.ubicacion_id) params.append('ubicacion_id', state.ubicacion_id);
  if (state.categoria_id) params.append('categoria_id', state.categoria_id);
  if (state.estatus_activo) params.append('estatus_activo', state.estatus_activo);

  if (state.tab === 'GASTO') {
    params.append('origen', 'GASTO');
  } else if (state.tab === 'CONTROL ADMINISTRATIVO' || state.tab === 'C.A.') {
    params.append('origen', 'CONTROL ADMINISTRATIVO');
  } else if (state.tab === 'DIRECCION GENERAL' || state.tab === 'CENTRAL') {
    params.append('origen', 'DIRECCION GENERAL');
  } else if (state.tab === 'PENDIENTES') {
    params.append('estatus_etiqueta', 'PENDIENTE_ETIQUETA');
  }

  try {
    const res = await authFetch(`/api/activos?${params.toString()}`);
    if (!res.ok) throw new Error('Error en la petición');
    const data = await res.json();

    state.totalPages = data.total_pages;
    state.totalItems = data.total;

    updatePaginationUI();
    renderTable(data.items);
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="py-8 text-center text-red-500 font-medium">
          <i class="fa-solid fa-circle-exclamation text-xl mb-1"></i>
          <p>Ocurrió un error al consultar los activos.</p>
        </td>
      </tr>
    `;
    console.error(err);
  }
}

// Renderizar filas de la tabla con las columnas solicitadas
function renderTable(items) {
  const tbody = document.getElementById('activos-table-body');
  
  if (!items || items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="py-12 text-center text-slate-400">
          <i class="fa-solid fa-box-open text-3xl mb-2 text-slate-300"></i>
          <p class="font-medium text-slate-600">No se encontraron activos con los filtros seleccionados.</p>
          <p class="text-xs text-slate-400 mt-1">Intenta con otro término de búsqueda o limpia los filtros.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const isChecked = state.selectedIds.has(item.id) ? 'checked' : '';
    const rol = state.user ? state.user.rol : 'consulta';

    // Columna 2: Miniatura interactiva de foto
    let fotoHtml = '';
    if (item.imagen_url) {
      const captionText = `${escapeHtml(item.descripcion)} (${item.codigo_oficial ? '#' + item.codigo_oficial : item.codigo_interno})`;
      fotoHtml = `
        <div class="relative group inline-block">
          <img 
            src="${item.imagen_url}" 
            alt="Foto" 
            onclick="openLightbox('${item.imagen_url}', '${captionText}', '${item.codigo_interno}', ${Boolean(item.es_foto_personalizada)})"
            class="w-8 h-8 rounded-lg object-cover cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-emerald-500 transition border border-slate-200 shadow-xs bg-slate-100"
            title="Clic para ver en tamaño completo"
          >
          ${item.es_foto_personalizada ? '<span class="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 border border-white rounded-full" title="Foto particular de este activo"></span>' : ''}
        </div>
      `;
    } else {
      if (rol === 'admin' || rol === 'resguardo') {
        fotoHtml = `
          <button 
            onclick="openImageUploadModal(${item.id}, '${escapeHtml(item.descripcion)}', '${escapeHtml(item.modelo || '')}')"
            class="w-8 h-8 rounded-lg border border-dashed border-slate-300 text-slate-300 hover:text-emerald-600 hover:border-emerald-500 hover:bg-emerald-50 transition flex items-center justify-center text-xs"
            title="Subir fotografía para este activo"
          >
            <i class="fa-solid fa-camera"></i>
          </button>
        `;
      } else {
        fotoHtml = `
          <span class="w-8 h-8 rounded-lg border border-slate-200 text-slate-300 flex items-center justify-center text-xs" title="Sin fotografía">
            <i class="fa-solid fa-image"></i>
          </span>
        `;
      }
    }

    // Columna 3: Número de inventario (oficial si existe, o código interno si pendiente)
    let invHtml = '';
    let btnAsignarTag = '';
    if (item.estatus_etiqueta === 'ETIQUETADO_OFICIAL' && item.codigo_oficial) {
      invHtml = `
        <div class="space-y-0.5">
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300" title="Código Oficial (Etiqueta Verde)">
            <i class="fa-solid fa-tag mr-1 text-emerald-600 text-[8px]"></i> #${item.codigo_oficial}
          </span>
          <div class="text-[10px] font-mono text-slate-400 leading-none">${item.codigo_interno}</div>
        </div>
      `;
    } else {
      invHtml = `
        <div class="space-y-0.5">
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-amber-100 text-amber-900 border border-amber-300" title="Código Interno provisional">
            ${item.codigo_interno}
          </span>
          <div class="text-[9px] text-amber-700 font-semibold flex items-center gap-1 leading-none">
            <i class="fa-solid fa-clock text-[8px]"></i> Pendiente
          </div>
        </div>
      `;
      btnAsignarTag = `
        <button 
          onclick="openTagModal(${item.id}, '${item.codigo_interno}', '${escapeHtml(item.descripcion)}')"
          title="Registrar Etiqueta Verde Oficial" 
          class="btn-pop-sm w-7.5 h-7.5 rounded-lg text-amber-800 bg-amber-100 hover:bg-amber-200 hover:text-amber-950 border border-amber-300 flex items-center justify-center transition text-xs shadow-xs"
        >
          <i class="fa-solid fa-tag"></i>
        </button>
      `;
    }

    // Badge sutil de origen / ubicación
    let origenPill = '';
    if (item.origen === 'GASTO') {
      origenPill = '<span class="text-amber-700 font-bold">Gasto</span>';
    } else if (item.origen === 'CONTROL ADMINISTRATIVO') {
      origenPill = '<span class="text-blue-700 font-bold">C.A.</span>';
    } else {
      origenPill = '<span class="text-emerald-700 font-bold">D.G.</span>';
    }

    return `
      <tr class="hover:bg-emerald-50/40 transition text-xs border-b border-slate-100/80">
        <!-- 1. Checkbox Selección -->
        <td class="py-2 px-2.5 text-center align-middle">
          <input type="checkbox" class="row-checkbox rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" data-id="${item.id}" ${isChecked} onchange="toggleRowSelection(${item.id}, this)">
        </td>

        <!-- 2. Foto -->
        <td class="py-1.5 px-2 text-center align-middle">
          ${fotoHtml}
        </td>

        <!-- 3. Número de Inventario -->
        <td class="py-2 px-3 whitespace-nowrap align-middle">
          ${invHtml}
        </td>

        <!-- 4. Descripción -->
        <td class="py-2 px-3 align-middle max-w-[220px]">
          <div class="font-bold text-slate-800 leading-tight truncate text-xs" title="${escapeHtml(item.descripcion)}">
            ${escapeHtml(item.descripcion)}
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1 leading-none truncate">
            ${origenPill}
            ${item.categoria ? `<span class="text-slate-400 truncate max-w-[130px]" title="${escapeHtml(item.categoria)}">· ${escapeHtml(item.categoria)}</span>` : ''}
          </div>
        </td>

        <!-- 5. Especificación -->
        <td class="py-2 px-3 align-middle max-w-[170px]">
          ${item.especificacion ? `
            <div class="text-slate-600 max-w-[160px] truncate leading-tight text-xs" title="${escapeHtml(item.especificacion)}">
              ${escapeHtml(item.especificacion)}
            </div>
          ` : '<span class="text-slate-300 italic text-[11px]">-</span>'}
        </td>

        <!-- 6. Número de Serie -->
        <td class="py-2 px-3 font-mono whitespace-nowrap align-middle max-w-[120px]">
          ${item.numero_serie ? `
            <span class="text-slate-700 font-semibold bg-slate-100 px-1.5 py-0.5 rounded text-[10px] border border-slate-200 inline-block max-w-[110px] truncate" title="${escapeHtml(item.numero_serie)}">
              ${escapeHtml(item.numero_serie)}
            </span>
          ` : '<span class="text-slate-300 italic text-[10px]">S/N</span>'}
        </td>

        <!-- 7. Marca -->
        <td class="py-2 px-2.5 align-middle max-w-[100px]">
          ${item.marca ? `<span class="font-semibold text-slate-700 block truncate" title="${escapeHtml(item.marca)}">${escapeHtml(item.marca)}</span>` : '<span class="text-slate-300 italic text-[11px]">-</span>'}
        </td>

        <!-- 8. Modelo -->
        <td class="py-2 px-2.5 align-middle max-w-[110px]">
          ${item.modelo ? `<span class="text-slate-600 font-medium block truncate" title="${escapeHtml(item.modelo)}">${escapeHtml(item.modelo)}</span>` : '<span class="text-slate-300 italic text-[11px]">-</span>'}
        </td>

        <!-- 9. Ubicación -->
        <td class="py-2 px-3 align-middle max-w-[170px]">
          ${item.ubicacion ? `
            <div class="flex items-center gap-1.5 text-slate-700 font-semibold max-w-[160px] min-w-0 text-xs" title="${escapeHtml(item.ubicacion)}">
              <i class="fa-solid fa-location-dot text-emerald-600 text-[10px] flex-shrink-0"></i>
              <span class="truncate min-w-0">${escapeHtml(item.ubicacion)}</span>
            </div>
          ` : '<span class="text-slate-300 italic text-[11px]">Sin asignar</span>'}
        </td>

        <!-- 10. Acciones -->
        <td class="py-2 px-3 text-center whitespace-nowrap align-middle">
          <div class="flex items-center justify-center gap-1">
            <button 
              onclick="openDetailModal(${item.id})"
              title="Ver detalle completo"
              class="btn-pop-sm w-8 h-8 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-900 border border-emerald-200/80 flex items-center justify-center transition text-xs shadow-xs"
            >
              <i class="fa-solid fa-circle-info"></i>
            </button>

            ${rol === 'admin' ? `
              <button 
                onclick="openEditModal(${item.id})"
                title="Editar activo"
                class="btn-pop-sm w-8 h-8 rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 hover:text-blue-900 border border-blue-200/80 flex items-center justify-center transition text-xs shadow-xs"
              >
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
            ` : ''}

            ${(rol === 'admin' || rol === 'resguardo') ? `
              <button 
                onclick="openCondicionModal(${item.id}, '${escapeHtml(item.descripcion)}', '${escapeHtml(item.condicion_actual || '')}', '${escapeHtml(item.estatus_activo || '')}', '${escapeHtml(item.ubicacion || '')}')"
                title="Actualizar Condición / Reportar Desuso"
                class="btn-pop-sm w-8 h-8 rounded-lg text-teal-700 bg-teal-50 hover:bg-teal-100 hover:text-teal-900 border border-teal-200/80 flex items-center justify-center transition text-xs shadow-xs"
              >
                <i class="fa-solid fa-clipboard-check"></i>
              </button>
              <button 
                onclick="openImageUploadModal(${item.id}, '${escapeHtml(item.descripcion)}', '${escapeHtml(item.modelo || '')}')"
                title="Subir o cambiar fotografía"
                class="btn-pop-sm w-8 h-8 rounded-lg text-purple-700 bg-purple-50 hover:bg-purple-100 hover:text-purple-900 border border-purple-200/80 flex items-center justify-center transition text-xs shadow-xs"
              >
                <i class="fa-solid fa-camera"></i>
              </button>
            ` : ''}

            <button 
              onclick="addSingleToQueue(${item.id})"
              title="Agregar a Cola de Impresión"
              class="btn-pop-sm w-8 h-8 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 flex items-center justify-center transition text-xs shadow-xs"
            >
              <i class="fa-solid fa-folder-plus"></i>
            </button>
            <button 
              onclick="openPrintSingle(${item.id})"
              title="Imprimir Etiqueta"
              class="btn-pop-sm w-8 h-8 rounded-lg text-slate-800 bg-slate-100 hover:bg-slate-200 hover:text-slate-950 border border-slate-300 flex items-center justify-center transition text-xs shadow-xs"
            >
              <i class="fa-solid fa-print"></i>
            </button>

            ${rol === 'admin' ? btnAsignarTag : ''}

            ${rol === 'admin' ? `
              <button 
                onclick="openDeleteModal(${item.id}, '${escapeHtml(item.descripcion)}')"
                title="Eliminar activo"
                class="btn-pop-sm w-8 h-8 rounded-lg text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-800 border border-red-200/80 flex items-center justify-center transition text-xs shadow-xs"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// GESTIÓN DE SELECCIÓN MÚLTIPLE (LOTE DE IMPRESIÓN)
// -------------------------------------------------------------
function toggleRowSelection(id, checkbox) {
  if (checkbox.checked) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }
  updateSelectedCountUI();
}

function toggleSelectAll(masterCheckbox) {
  const checkboxes = document.querySelectorAll('.row-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = masterCheckbox.checked;
    const id = parseInt(cb.dataset.id, 10);
    if (masterCheckbox.checked) {
      state.selectedIds.add(id);
    } else {
      state.selectedIds.delete(id);
    }
  });
  updateSelectedCountUI();
}

function clearSelection() {
  state.selectedIds.clear();
  const master = document.getElementById('select-all');
  if (master) master.checked = false;
  document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
  updateSelectedCountUI();
}

function updateSelectedCountUI() {
  const count = state.selectedIds.size;
  const bar = document.getElementById('bulk-actions-bar');
  const countBadge = document.getElementById('selected-count-badge');
  const btnSelectAllFiltered = document.getElementById('btn-select-all-filtered');
  const selectAllText = document.getElementById('select-all-filtered-text');

  if (countBadge) countBadge.textContent = count;

  if (count > 0) {
    bar.classList.remove('hidden');
    if (state.totalItems > count && btnSelectAllFiltered) {
      btnSelectAllFiltered.classList.remove('hidden');
      if (selectAllText) selectAllText.textContent = `Seleccionar los ${state.totalItems} del filtro`;
    } else if (btnSelectAllFiltered) {
      btnSelectAllFiltered.classList.add('hidden');
    }
  } else {
    bar.classList.add('hidden');
  }
}

// UI Paginación
function updatePaginationUI() {
  document.getElementById('current-page').textContent = state.page;
  document.getElementById('total-pages').textContent = state.totalPages;
  document.getElementById('btn-prev').disabled = state.page <= 1;
  document.getElementById('btn-next').disabled = state.page >= state.totalPages;

  const resultsSpan = document.getElementById('results-count');
  resultsSpan.textContent = `Mostrando ${state.totalItems.toLocaleString()} activos`;

  const badge = document.getElementById('active-filter-badge');
  if (state.tab) {
    badge.textContent = `Sección: ${state.tab}`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Desmarcar select-all al cambiar de página
  const master = document.getElementById('select-all');
  if (master) master.checked = false;
}

// Pestañas
function setTab(tabName) {
  state.tab = tabName;
  state.page = 1;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-white', 'text-emerald-950', 'shadow');
    btn.classList.add('text-emerald-100', 'hover:bg-emerald-800/60');
  });

  const activeId = tabName === '' ? 'tab-all' :
                   tabName === 'GASTO' ? 'tab-gasto' :
                   (tabName === 'CONTROL ADMINISTRATIVO' || tabName === 'C.A.') ? 'tab-ca' :
                   (tabName === 'DIRECCION GENERAL' || tabName === 'CENTRAL') ? 'tab-central' :
                   tabName === 'PENDIENTES' ? 'tab-pendientes' : 'tab-all';

  const activeBtn = document.getElementById(activeId);
  if (activeBtn) {
    activeBtn.classList.remove('text-emerald-100', 'hover:bg-emerald-800/60');
    activeBtn.classList.add('bg-white', 'text-emerald-950', 'shadow');
  }

  loadActivos();
}

let searchDebounceTimer = null;
function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    applyFilters();
  }, 280);
}

function applyFilters() {
  state.q = document.getElementById('search-input').value;
  state.ubicacion_id = document.getElementById('filter-ubicacion').value;
  state.categoria_id = document.getElementById('filter-categoria').value;
  state.estatus_activo = document.getElementById('filter-estatus-operativo').value;
  state.page = 1;

  const clearBtn = document.getElementById('clear-search-btn');
  if (state.q.trim()) clearBtn.classList.remove('hidden');
  else clearBtn.classList.add('hidden');

  loadActivos();
}

function clearSearchInput() {
  document.getElementById('search-input').value = '';
  document.getElementById('clear-search-btn').classList.add('hidden');
  applyFilters();
}

function resetAllFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('filter-ubicacion').value = '';
  document.getElementById('filter-categoria').value = '';
  document.getElementById('filter-estatus-operativo').value = '';
  document.getElementById('clear-search-btn').classList.add('hidden');
  state.q = '';
  state.ubicacion_id = '';
  state.categoria_id = '';
  state.estatus_activo = '';
  state.page = 1;
  clearSelection();
  loadActivos();
}

function changeLimit() {
  state.limit = parseInt(document.getElementById('limit-select').value, 10);
  state.page = 1;
  loadActivos();
}

function prevPage() {
  if (state.page > 1) {
    state.page--;
    loadActivos();
  }
}

function nextPage() {
  if (state.page < state.totalPages) {
    state.page++;
    loadActivos();
  }
}

// -------------------------------------------------------------
// MODAL CRUD: REGISTRAR / EDITAR ACTIVO
// -------------------------------------------------------------
function updatePriceIndicator() {
  const origen = document.getElementById('form-origen').value;
  const ind = document.getElementById('source-price-indicator');
  const preview = document.getElementById('auto-code-preview');

  let previewCode = 'PL3-GTO-XXXX';
  if (origen === 'CONTROL ADMINISTRATIVO') previewCode = 'PL3-CA-XXXX';
  else if (origen === 'DIRECCION GENERAL') previewCode = 'PL3-DG-XXXXXX';

  if (preview) preview.textContent = previewCode;

  if (!ind) return;

  if (origen === 'GASTO') {
    ind.className = 'p-2.5 rounded-xl border bg-amber-50 border-amber-200 text-amber-900 text-xs flex items-center gap-2';
    ind.innerHTML = `
      <i class="fa-solid fa-receipt text-amber-600 text-sm flex-shrink-0"></i>
      <div>
        <span class="font-bold">Gasto Corriente ($1 a $3,000 MXN):</span> Fondos propios del plantel. Consecutivo automático <code class="font-mono font-bold bg-amber-100 px-1 py-0.5 rounded">PL3-GTO-XXXX</code>.
      </div>
    `;
  } else if (origen === 'CONTROL ADMINISTRATIVO') {
    ind.className = 'p-2.5 rounded-xl border bg-blue-50 border-blue-200 text-blue-900 text-xs flex items-center gap-2';
    ind.innerHTML = `
      <i class="fa-solid fa-users-gear text-blue-600 text-sm flex-shrink-0"></i>
      <div>
        <span class="font-bold">Control Administrativo / C.A. ($3,001 a $7,900 MXN):</span> Etiqueta Genérica D.B.P. Consecutivo <code class="font-mono font-bold bg-blue-100 px-1 py-0.5 rounded">PL3-CA-XXXX</code>.
      </div>
    `;
  } else {
    ind.className = 'p-2.5 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-900 text-xs flex items-center gap-2';
    ind.innerHTML = `
      <i class="fa-solid fa-building-columns text-emerald-700 text-sm flex-shrink-0"></i>
      <div>
        <span class="font-bold">Código Etiqueta (D.G):</span> Asignado por Dirección General. Portará Etiqueta Verde Oficial con Código numérico. Consecutivo <code class="font-mono font-bold bg-emerald-100 px-1 py-0.5 rounded">PL3-DG-XXXXXX</code>.
      </div>
    `;
  }
}

function openCreateModal() {
  document.getElementById('asset-form-id').value = '';
  document.getElementById('asset-form-title').textContent = 'Registrar Nuevo Activo';
  document.getElementById('asset-form-icon').className = 'fa-solid fa-plus-circle text-amber-400 text-lg';
  document.getElementById('btn-save-asset').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Registrar Activo';
  
  if (state.tab === 'CONTROL ADMINISTRATIVO' || state.tab === 'C.A.') {
    document.getElementById('form-origen').value = 'CONTROL ADMINISTRATIVO';
  } else if (state.tab === 'DIRECCION GENERAL' || state.tab === 'CENTRAL') {
    document.getElementById('form-origen').value = 'DIRECCION GENERAL';
  } else {
    document.getElementById('form-origen').value = 'GASTO';
  }

  document.getElementById('form-condicion').value = 'Buena 61% - 80%';
  document.getElementById('form-costo').value = '';
  document.getElementById('form-estatus-operativo').value = 'OPERATIVO';
  
  // Toggle contenedores de código: mostrar auto badge, ocultar input bloqueado
  const autoContainer = document.getElementById('container-codigo-auto');
  const editContainer = document.getElementById('container-codigo-edit');
  if (autoContainer) autoContainer.classList.remove('hidden');
  if (editContainer) editContainer.classList.add('hidden');
  document.getElementById('form-codigo-interno').value = '';

  document.getElementById('form-codigo-oficial').value = '';
  document.getElementById('form-descripcion').value = '';
  document.getElementById('form-marca').value = '';
  document.getElementById('form-modelo').value = '';
  document.getElementById('form-numero-serie').value = '';
  document.getElementById('form-ubicacion').value = '';
  document.getElementById('form-categoria').value = '';
  document.getElementById('form-resguardante').value = '';
  document.getElementById('form-especificacion').value = '';
  document.getElementById('form-observaciones').value = '';
  document.getElementById('asset-form-error').classList.add('hidden');

  updatePriceIndicator();
  document.getElementById('modal-asset-form').classList.remove('hidden');
}

async function openEditModal(id) {
  try {
    const res = await authFetch(`/api/activos/${id}`);
    if (!res.ok) throw new Error('No se pudo cargar el activo');
    const a = await res.json();

    document.getElementById('asset-form-id').value = a.id;
    document.getElementById('asset-form-title').textContent = `Editar Activo: ${a.codigo_interno}`;
    document.getElementById('asset-form-icon').className = 'fa-solid fa-pen-to-square text-amber-400 text-lg';
    document.getElementById('btn-save-asset').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Cambios';

    document.getElementById('form-origen').value = a.origen;
    document.getElementById('form-condicion').value = a.condicion_actual || a.condicion || 'Buena 61% - 80%';
    document.getElementById('form-costo').value = a.costo !== null && a.costo !== undefined ? a.costo : '';
    document.getElementById('form-estatus-operativo').value = a.estatus_activo;

    // Toggle contenedores de código: ocultar auto badge, mostrar input bloqueado
    const autoContainer = document.getElementById('container-codigo-auto');
    const editContainer = document.getElementById('container-codigo-edit');
    if (autoContainer) autoContainer.classList.add('hidden');
    if (editContainer) editContainer.classList.remove('hidden');
    document.getElementById('form-codigo-interno').value = a.codigo_interno;

    document.getElementById('form-codigo-oficial').value = a.codigo_oficial || '';
    document.getElementById('form-descripcion').value = a.descripcion;
    document.getElementById('form-marca').value = a.marca || '';
    document.getElementById('form-modelo').value = a.modelo || '';
    document.getElementById('form-numero-serie').value = a.numero_serie || '';
    document.getElementById('form-ubicacion').value = a.ubicacion || '';
    document.getElementById('form-categoria').value = a.categoria || '';
    document.getElementById('form-resguardante').value = a.resguardante || '';
    document.getElementById('form-especificacion').value = a.especificacion || '';
    document.getElementById('form-observaciones').value = a.observaciones || '';
    document.getElementById('asset-form-error').classList.add('hidden');

    updatePriceIndicator();
    document.getElementById('modal-asset-form').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, true);
  }
}

function closeAssetFormModal() {
  document.getElementById('modal-asset-form').classList.add('hidden');
}

async function submitAssetForm(e) {
  e.preventDefault();
  const id = document.getElementById('asset-form-id').value;
  const isEdit = Boolean(id);

  const costoVal = document.getElementById('form-costo').value.trim();

  const payload = {
    origen: document.getElementById('form-origen').value,
    condicion_actual: document.getElementById('form-condicion').value,
    costo: costoVal ? parseFloat(costoVal) : null,
    estatus_operativo: document.getElementById('form-estatus-operativo').value,
    codigo_interno: isEdit ? (document.getElementById('form-codigo-interno').value.trim() || null) : null,
    codigo_oficial: document.getElementById('form-codigo-oficial').value.trim() || null,
    descripcion: document.getElementById('form-descripcion').value.trim(),
    marca: document.getElementById('form-marca').value.trim() || null,
    modelo: document.getElementById('form-modelo').value.trim() || null,
    numero_serie: document.getElementById('form-numero-serie').value.trim() || null,
    ubicacion_nombre: document.getElementById('form-ubicacion').value.trim() || null,
    categoria_nombre: document.getElementById('form-categoria').value.trim() || null,
    resguardante_nombre: document.getElementById('form-resguardante').value.trim() || null,
    especificacion: document.getElementById('form-especificacion').value.trim() || null,
    observaciones: document.getElementById('form-observaciones').value.trim() || null
  };

  const errorDiv = document.getElementById('asset-form-error');
  const btnSave = document.getElementById('btn-save-asset');
  errorDiv.classList.add('hidden');
  btnSave.disabled = true;

  try {
    const url = isEdit ? `/api/activos/${id}` : '/api/activos';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await authFetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al guardar el activo');

    closeAssetFormModal();
    showToast(isEdit ? '¡Activo actualizado con éxito!' : '¡Activo registrado con éxito!');
    await Promise.all([loadStats(), loadCatalogos(), loadActivos()]);
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  } finally {
    btnSave.disabled = false;
  }
}

// -------------------------------------------------------------
// MODAL: ELIMINAR ACTIVO
// -------------------------------------------------------------
function openDeleteModal(id, desc) {
  state.deletingId = id;
  document.getElementById('modal-delete-desc').textContent = `¿Estás seguro de eliminar "${desc}"? Esta acción no se puede deshacer.`;
  document.getElementById('modal-delete').classList.remove('hidden');
}

function closeDeleteModal() {
  state.deletingId = null;
  document.getElementById('modal-delete').classList.add('hidden');
}

async function confirmDelete() {
  if (!state.deletingId) return;
  const btn = document.getElementById('btn-confirm-delete');
  btn.disabled = true;

  try {
    const res = await authFetch(`/api/activos/${state.deletingId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar');
    closeDeleteModal();
    state.selectedIds.delete(state.deletingId);
    updateSelectedCountUI();
    showToast('Activo eliminado correctamente');
    await Promise.all([loadStats(), loadActivos()]);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// -------------------------------------------------------------
// MODAL: DETALLE COMPLETO
// -------------------------------------------------------------
async function openDetailModal(id) {
  const modal = document.getElementById('modal-detail');
  const content = document.getElementById('modal-detail-content');
  const title = document.getElementById('modal-detail-title');
  const badge = document.getElementById('modal-detail-badge');
  const opBadge = document.getElementById('modal-detail-operativo-badge');
  const actionsContainer = document.getElementById('modal-detail-actions');

  content.innerHTML = `
    <div class="py-10 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-2xl text-emerald-600"></i>
      <p class="mt-2 text-xs">Cargando detalles...</p>
    </div>
  `;
  modal.classList.remove('hidden');

  try {
    const res = await authFetch(`/api/activos/${id}`);
    if (!res.ok) throw new Error('Error al cargar detalle');
    const a = await res.json();
    const rol = state.user ? state.user.rol : 'consulta';

    title.textContent = a.descripcion;
    badge.textContent = `${a.origen} · ${a.codigo_interno}`;
    badge.className = `text-[11px] font-bold px-2 py-0.5 rounded-md ${
      a.origen === 'GASTO' ? 'badge-gasto' :
      a.origen === 'CONTROL ADMINISTRATIVO' ? 'badge-ca' : 'badge-central'
    }`;

    opBadge.textContent = a.estatus_activo;
    opBadge.className = `text-[11px] font-bold px-2 py-0.5 rounded-md ${
      a.estatus_activo === 'OPERATIVO' ? 'bg-emerald-100 text-emerald-800' :
      a.estatus_activo === 'EN_DESUSO' ? 'bg-red-100 text-red-800' :
      a.estatus_activo === 'EN_REPARACION' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'
    }`;

    let detailButtons = `
      <button onclick="addSingleToQueue(${a.id})" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition btn-pop flex items-center gap-1.5">
        <i class="fa-solid fa-folder-plus"></i> + Cola
      </button>
      <button onclick="closeDetailModal(); openPrintSingle(${a.id})" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-xl text-xs transition btn-pop flex items-center gap-1.5">
        <i class="fa-solid fa-print"></i> Imprimir Etiqueta
      </button>
    `;

    if (rol === 'admin' || rol === 'resguardo') {
      detailButtons += `
        <button onclick="closeDetailModal(); openCondicionModal(${a.id}, '${escapeHtml(a.descripcion)}', '${escapeHtml(a.condicion_actual || '')}', '${escapeHtml(a.estatus_activo || '')}', '${escapeHtml(a.ubicacion || '')}')" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-xl text-xs transition btn-pop flex items-center gap-1.5">
          <i class="fa-solid fa-clipboard-check"></i> Condición / Desuso
        </button>
      `;
    }

    if (rol === 'admin') {
      detailButtons += `
        <button onclick="closeDetailModal(); openEditModal(${a.id})" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs transition btn-pop flex items-center gap-1.5">
          <i class="fa-solid fa-pen-to-square"></i> Editar
        </button>
      `;
    }
    actionsContainer.innerHTML = detailButtons;

    // 1. Tarjeta de Fotografía
    let photoBlock = '';
    if (a.imagen_url) {
      let photoActions = '';
      if (rol === 'admin' || rol === 'resguardo') {
        photoActions += `
          <button onclick="openImageUploadModal(${a.id}, '${escapeHtml(a.descripcion)}', '${escapeHtml(a.modelo || '')}')" class="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-[11px] font-bold transition flex items-center gap-1">
            <i class="fa-solid fa-camera"></i> Cambiar Foto
          </button>
        `;
      }
      if (rol === 'admin') {
        photoActions += `
          <button onclick="removeActivoPhoto(${a.id})" class="px-2.5 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg text-[11px] font-medium transition flex items-center gap-1">
            <i class="fa-solid fa-trash"></i> Quitar
          </button>
        `;
      }

      photoBlock = `
        <div class="flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
          <img 
            src="${a.imagen_url}" 
            alt="Foto del activo" 
            onclick="openLightbox('${a.imagen_url}', '${escapeHtml(a.descripcion)}', '${a.codigo_interno}', ${Boolean(a.es_foto_personalizada)})"
            class="w-20 h-20 rounded-xl object-cover cursor-pointer hover:opacity-90 hover:scale-105 transition border border-slate-200 shadow-sm bg-white flex-shrink-0"
            title="Clic para ver en tamaño completo"
          >
          <div class="flex-1 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-bold text-slate-800">Fotografía Asignada</span>
              ${a.es_foto_personalizada ? 
                '<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-300"><i class="fa-solid fa-camera mr-1"></i>Foto particular / detalle físico</span>' : 
                '<span class="bg-slate-200 text-slate-700 text-[10px] font-medium px-2 py-0.5 rounded"><i class="fa-solid fa-layer-group mr-1"></i>Foto de modelo / catálogo</span>'
              }
            </div>
            <p class="text-[11px] text-slate-500">Haz clic en la imagen para ampliarla en alta resolución.</p>
            ${photoActions ? `<div class="flex items-center gap-2 pt-1">${photoActions}</div>` : ''}
          </div>
        </div>
      `;
    } else {
      photoBlock = `
        <div class="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-slate-200 text-slate-400 flex items-center justify-center text-lg">
              <i class="fa-regular fa-image"></i>
            </div>
            <div>
              <span class="text-xs font-bold text-slate-700">Sin Fotografía Registrada</span>
              <p class="text-[11px] text-slate-400">Puedes tomar o subir una fotografía para documentar este activo o su modelo.</p>
            </div>
          </div>
          ${(rol === 'admin' || rol === 'resguardo') ? `
            <button onclick="openImageUploadModal(${a.id}, '${escapeHtml(a.descripcion)}', '${escapeHtml(a.modelo || '')}')" class="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs whitespace-nowrap">
              <i class="fa-solid fa-camera"></i> Subir Foto
            </button>
          ` : ''}
        </div>
      `;
    }

    // 2. Tarjeta comparativa de Condición Física (D.G. vs Plantel 3)
    const condDgText = a.condicion_dg || 'Sin registro en D.G.';
    const condActText = a.condicion_actual || a.condicion || 'Buena 61% - 80%';
    const esDeteriorado = (condDgText.includes('81%') || condDgText.includes('61%')) && (condActText.includes('41%') || condActText.includes('0%'));

    const condicionCard = `
      <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">Condición Física y Justificación Patrimonial</h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div class="bg-white p-2.5 rounded-lg border border-slate-200">
            <span class="text-slate-400 block uppercase text-[10px]">Condición Origen (Dirección General)</span>
            <span class="font-bold text-slate-800">${condDgText}</span>
          </div>
          <div class="bg-white p-2.5 rounded-lg border border-slate-200">
            <span class="text-slate-400 block uppercase text-[10px]">Condición Actual (Plantel 3)</span>
            <span class="font-bold text-slate-800">${condActText}</span>
          </div>
        </div>
        ${esDeteriorado ? `
          <div class="p-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation text-amber-600 text-sm"></i>
            <div>
              <strong>Deterioro documentado respecto a D.G.:</strong> El activo pasó de condición óptima a degradada. Proporciona sustento técnico oficial para la justificación del trámite de <strong>baja patrimonial</strong>.
            </div>
          </div>
        ` : ''}
      </div>
    `;

    let historialHtml = '';
    if (a.historial_etiquetas && a.historial_etiquetas.length > 0) {
      historialHtml = `
        <div class="border-t border-slate-100 pt-3">
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Historial de Etiquetado</h4>
          <div class="space-y-2">
            ${a.historial_etiquetas.map(h => `
              <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-900">
                <div class="flex justify-between font-semibold">
                  <span>Etiqueta Verde Asignada: #${h.codigo_oficial_asignado}</span>
                  <span class="text-emerald-700 font-normal">${new Date(h.fecha_asignacion).toLocaleDateString()}</span>
                </div>
                <div class="text-emerald-700 text-[11px] mt-0.5">Por: ${escapeHtml(h.asignado_por || 'Personal')}</div>
                ${h.notas ? `<p class="mt-1 text-[11px] italic text-emerald-800">"${escapeHtml(h.notas)}"</p>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    content.innerHTML = `
      ${photoBlock}

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
        <div>
          <span class="text-slate-400 block uppercase tracking-wider text-[10px]">Código Interno</span>
          <span class="font-mono font-bold text-slate-800">${a.codigo_interno}</span>
        </div>
        <div>
          <span class="text-slate-400 block uppercase tracking-wider text-[10px]">Etiqueta Verde (Código)</span>
          <span class="font-bold text-emerald-700">${a.codigo_oficial ? `#${a.codigo_oficial}` : '<span class="text-amber-600 font-normal">Sin asignar</span>'}</span>
        </div>
        <div>
          <span class="text-slate-400 block uppercase tracking-wider text-[10px]">Estado Etiqueta</span>
          <span class="font-medium">${a.estatus_etiqueta === 'ETIQUETADO_OFICIAL' ? 'Oficial' : 'Pendiente'}</span>
        </div>
        <div>
          <span class="text-slate-400 block uppercase tracking-wider text-[10px]">Marca</span>
          <span class="font-semibold text-slate-700">${a.marca || '-'}</span>
        </div>
        <div>
          <span class="text-slate-400 block uppercase tracking-wider text-[10px]">Modelo</span>
          <span class="font-semibold text-slate-700">${a.modelo || '-'}</span>
        </div>
        <div>
          <span class="text-slate-400 block uppercase tracking-wider text-[10px]">Número de Serie</span>
          <span class="font-mono font-semibold text-slate-700">${a.numero_serie || 'S/N'}</span>
        </div>
      </div>

      ${condicionCard}

      <div>
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Especificaciones Técnicas</h4>
        <p class="text-slate-700 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          ${a.especificacion || 'Sin especificaciones registradas.'}
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span class="text-slate-400 block uppercase text-[10px]">Ubicación Física</span>
          <span class="font-semibold text-slate-800">${a.ubicacion || 'No asignada'}</span>
        </div>
        <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span class="text-slate-400 block uppercase text-[10px]">Resguardante</span>
          <span class="font-semibold text-slate-800">${a.resguardante || 'No asignado'}</span>
        </div>
        <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span class="text-slate-400 block uppercase text-[10px]">Categoría</span>
          <span class="font-semibold text-slate-800">${a.categoria || 'Sin categoría'}</span>
        </div>
        <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <span class="text-slate-400 block uppercase text-[10px]">Fuente de Adquisición</span>
          <span class="font-semibold text-slate-800">${a.origen}</span>
        </div>
      </div>

      ${a.costo ? `
        <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs">
          <span class="text-slate-400 block uppercase text-[10px]">Costo Registrado</span>
          <span class="font-bold text-slate-800">$${a.costo.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</span>
        </div>
      ` : ''}

      ${a.observaciones ? `
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Observaciones / Comentarios</h4>
          <p class="text-slate-700 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100 whitespace-pre-line">${escapeHtml(a.observaciones)}</p>
        </div>
      ` : ''}

      ${historialHtml}
    `;
  } catch (err) {
    content.innerHTML = `<p class="text-red-500 font-medium text-xs">Error al cargar la información.</p>`;
  }
}

function closeDetailModal() {
  document.getElementById('modal-detail').classList.add('hidden');
}

// -------------------------------------------------------------
// MODAL: ASIGNAR ETIQUETA VERDE
// -------------------------------------------------------------
function openTagModal(id, codigoInterno, descripcion) {
  document.getElementById('tag-activo-id').value = id;
  document.getElementById('modal-tag-desc').textContent = descripcion;
  document.getElementById('modal-tag-meta').textContent = `Código Interno: ${codigoInterno}`;
  document.getElementById('input-codigo-oficial').value = '';
  document.getElementById('input-tag-notas').value = '';
  document.getElementById('tag-error').classList.add('hidden');
  document.getElementById('modal-tag').classList.remove('hidden');
  setTimeout(() => document.getElementById('input-codigo-oficial').focus(), 50);
}

function closeTagModal() {
  document.getElementById('modal-tag').classList.add('hidden');
}

async function submitTag(e) {
  e.preventDefault();
  const activoId = document.getElementById('tag-activo-id').value;
  const codigoOficial = document.getElementById('input-codigo-oficial').value.trim();
  const responsable = document.getElementById('input-tag-responsable').value.trim();
  const notas = document.getElementById('input-tag-notas').value.trim();
  const errorDiv = document.getElementById('tag-error');
  const btnSubmit = document.getElementById('btn-submit-tag');

  errorDiv.classList.add('hidden');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Guardando...';

  try {
    const res = await authFetch(`/api/activos/${activoId}/asignar-etiqueta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo_oficial: codigoOficial,
        asignado_por: responsable,
        notas: notas
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'No fue posible asignar la etiqueta');

    closeTagModal();
    showToast(`¡Etiqueta #${codigoOficial} asignada con éxito!`);
    await Promise.all([loadStats(), loadActivos()]);
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<i class="fa-solid fa-check mr-1.5"></i> Guardar Etiqueta';
  }
}

// -------------------------------------------------------------
// GESTIÓN DE COLA DE IMPRESIÓN (CARRITO / LOTES)
// -------------------------------------------------------------
function loadQueueFromStorage() {
  try {
    const raw = localStorage.getItem('cobach3_print_queue');
    if (raw) {
      const arr = JSON.parse(raw);
      state.printQueue = new Map(arr);
    }
  } catch (e) {
    state.printQueue = new Map();
  }
  updateQueueBadgeUI();
}

function saveQueueToStorage() {
  try {
    const arr = Array.from(state.printQueue.entries());
    localStorage.setItem('cobach3_print_queue', JSON.stringify(arr));
  } catch (e) {
    console.error('Error guardando cola:', e);
  }
  updateQueueBadgeUI();
}

function updateQueueBadgeUI() {
  let totalLabels = 0;
  state.printQueue.forEach(item => {
    totalLabels += (item.copies || 1);
  });
  const badge = document.getElementById('queue-badge');
  if (badge) {
    badge.textContent = totalLabels;
    if (totalLabels > 0) {
      badge.className = 'bg-amber-400 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none';
    } else {
      badge.className = 'bg-emerald-600 text-emerald-100 text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none';
    }
  }
}

async function addSingleToQueue(id) {
  try {
    let activo = (state.currentPrintItems || []).find(a => a.id === id);
    if (!activo) {
      const res = await authFetch(`/api/activos/${id}`);
      if (!res.ok) throw new Error('No se pudo obtener el activo');
      activo = await res.json();
    }
    const existing = state.printQueue.get(id);
    if (existing) {
      existing.copies = (existing.copies || 1) + 1;
    } else {
      state.printQueue.set(id, { ...activo, copies: 1 });
    }
    saveQueueToStorage();
    showToast(`"${activo.codigo_interno}" agregado a la cola (${state.printQueue.get(id).copies} copias)`);
  } catch (err) {
    showToast('Error al agregar a la cola', true);
  }
}

async function addSelectedToQueue() {
  if (state.selectedIds.size === 0) return;
  const count = state.selectedIds.size;
  showToast(`Agregando ${count} activos a la cola...`);

  try {
    const ids = Array.from(state.selectedIds);
    const promises = ids.map(id => {
      const existing = state.printQueue.get(id);
      if (existing) {
        existing.copies = (existing.copies || 1) + 1;
        return Promise.resolve(existing);
      }
      return authFetch(`/api/activos/${id}`).then(r => r.json()).then(activo => {
        state.printQueue.set(id, { ...activo, copies: 1 });
      });
    });
    await Promise.all(promises);
    saveQueueToStorage();
    clearSelection();
    showToast(`¡${count} activo(s) añadidos a la cola de impresión!`);
  } catch (err) {
    showToast('Error al procesar la cola', true);
  }
}

async function selectAllFilteredActivos() {
  try {
    showToast('Cargando todos los activos del filtro actual...');
    const params = new URLSearchParams();
    if (state.tab) params.append('origen', state.tab === 'PENDIENTES' ? '' : state.tab);
    if (state.tab === 'PENDIENTES') params.append('estatus_etiqueta', 'PENDIENTE_ETIQUETA');
    if (state.q) params.append('q', state.q);
    if (state.ubicacion_id) params.append('ubicacion_id', state.ubicacion_id);
    if (state.categoria_id) params.append('categoria_id', state.categoria_id);
    if (state.estatus_activo) params.append('estatus_activo', state.estatus_activo);
    params.append('page', '1');
    params.append('limit', '2500');

    const res = await authFetch(`/api/activos?${params.toString()}`);
    if (!res.ok) throw new Error('Error al cargar activos');
    const data = await res.json();
    data.items.forEach(item => state.selectedIds.add(item.id));

    // Marcar checkboxes visibles
    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = true);
    const master = document.getElementById('select-all');
    if (master) master.checked = true;

    updateSelectedCountUI();
    showToast(`¡${state.selectedIds.size} activos seleccionados!`);
  } catch (err) {
    showToast('Error al seleccionar todo el filtro', true);
  }
}

function openPrintQueueModal() {
  buildQueuePrintItems();
  const panel = document.getElementById('print-queue-panel');
  if (panel) panel.classList.remove('hidden');
  const txt = document.getElementById('toggle-queue-panel-text');
  if (txt) txt.textContent = 'Ocultar Lista';
  renderQueueItemsList();
  showPrintModal();
}

function buildQueuePrintItems() {
  const items = [];
  state.printQueue.forEach(entry => {
    const c = entry.copies || 1;
    for (let i = 0; i < c; i++) {
      items.push(entry);
    }
  });
  state.basePrintItems = Array.from(state.printQueue.values());
  state.currentPrintItems = items;
  document.getElementById('print-sheet-count').textContent = items.length;
  const pages = Math.ceil(items.length / 10) || 1;
  document.getElementById('print-pages-count').textContent = pages;
}

function toggleQueuePanel() {
  const panel = document.getElementById('print-queue-panel');
  const txt = document.getElementById('toggle-queue-panel-text');
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    txt.textContent = 'Ocultar Lista';
    renderQueueItemsList();
  } else {
    panel.classList.add('hidden');
    txt.textContent = 'Ver / Editar Lista';
  }
}

function renderQueueItemsList() {
  const list = document.getElementById('print-queue-items-list');
  if (!list) return;
  if (state.printQueue.size === 0) {
    list.innerHTML = `
      <div class="py-5 text-center text-slate-500">
        <i class="fa-solid fa-tags text-2xl mb-1.5 text-slate-400"></i>
        <p class="font-bold text-slate-700 text-xs">Tu cola de impresión está vacía</p>
        <p class="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">Agrega activos usando el botón <strong class="text-blue-600"><i class="fa-solid fa-folder-plus"></i></strong> en cada fila de la tabla o marcando casillas y pulsando <em>"Agregar a Cola"</em>.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = Array.from(state.printQueue.values()).map(item => `
    <div class="py-2 flex items-center justify-between gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-mono font-bold text-slate-800">${item.codigo_interno}</span>
          ${item.codigo_oficial ? `<span class="text-[10px] text-emerald-700 font-bold">#${item.codigo_oficial}</span>` : ''}
          <span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded font-bold">${item.origen}</span>
        </div>
        <div class="text-slate-600 truncate text-[11px] mt-0.5">${escapeHtml(item.descripcion)}</div>
      </div>
      <div class="flex items-center gap-1.5">
        <button onclick="updateQueueItemCopies(${item.id}, -1)" class="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold flex items-center justify-center text-xs">-</button>
        <span class="font-mono font-bold w-6 text-center text-xs">${item.copies || 1}</span>
        <button onclick="updateQueueItemCopies(${item.id}, 1)" class="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold flex items-center justify-center text-xs">+</button>
        <button onclick="removeQueueItem(${item.id})" class="ml-2 text-red-500 hover:text-red-700 p-1" title="Quitar de la cola">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function updateQueueItemCopies(id, delta) {
  const item = state.printQueue.get(id);
  if (!item) return;
  item.copies = Math.max(1, (item.copies || 1) + delta);
  saveQueueToStorage();
  buildQueuePrintItems();
  renderQueueItemsList();
  regeneratePrintLabels();
}

function removeQueueItem(id) {
  state.printQueue.delete(id);
  saveQueueToStorage();
  buildQueuePrintItems();
  renderQueueItemsList();
  regeneratePrintLabels();
  if (state.printQueue.size === 0) {
    closePrintModal();
    showToast('Cola vaciada.');
  }
}

function clearPrintQueue() {
  state.printQueue.clear();
  saveQueueToStorage();
  closePrintModal();
  showToast('Cola de impresión vaciada.');
}

function changeBorderStyle(style) {
  state.borderStyle = style;
  regeneratePrintLabels();
}

// -------------------------------------------------------------
// MODAL: IMPRESIÓN DE HOJA DE ETIQUETAS (10 POR HOJA CARTA)
// -------------------------------------------------------------
async function openPrintSingle(id) {
  try {
    const res = await authFetch(`/api/activos/${id}`);
    if (!res.ok) throw new Error('No se pudo obtener el activo');
    const activo = await res.json();
    state.basePrintItems = [activo];
    state.printCopies = 1;
    showPrintModal();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openBulkPrintModal() {
  if (state.selectedIds.size === 0) {
    showToast('Selecciona al menos un activo para imprimir', true);
    return;
  }

  try {
    showToast(`Preparando hoja para ${state.selectedIds.size} activo(s)...`);
    const ids = Array.from(state.selectedIds);
    // Obtener detalles de todos los activos seleccionados
    const promises = ids.map(id => authFetch(`/api/activos/${id}`).then(r => r.json()));
    const items = await Promise.all(promises);
    state.basePrintItems = items;
    state.printCopies = 1;
    showPrintModal();
  } catch (err) {
    showToast('Error al preparar etiquetas', true);
  }
}

function showPrintModal() {
  const fillBtn = document.getElementById('btn-fill-sheet');
  if (state.basePrintItems && state.basePrintItems.length === 1) {
    fillBtn.classList.remove('hidden');
  } else {
    fillBtn.classList.add('hidden');
  }
  document.getElementById('print-copies-input').value = state.printCopies || 1;
  rebuildPrintItems();
  document.getElementById('modal-print').classList.remove('hidden');
}

function closePrintModal() {
  document.getElementById('modal-print').classList.add('hidden');
}

function changePrintCopies(val) {
  const n = parseInt(val, 10);
  state.printCopies = isNaN(n) || n < 1 ? 1 : Math.min(n, 100);
  document.getElementById('print-copies-input').value = state.printCopies;
  rebuildPrintItems();
}

function fillSheetWithSingle() {
  state.printCopies = 10;
  document.getElementById('print-copies-input').value = 10;
  
  // Si se abrió desde la cola y la cola tiene 1 solo elemento, sincronizar sus copias
  if (state.printQueue && state.printQueue.size === 1) {
    const onlyItem = Array.from(state.printQueue.values())[0];
    onlyItem.copies = 10;
    saveQueueToStorage();
    renderQueueItemsList();
    updateQueueBadge();
  }

  rebuildPrintItems();
  showToast('Hoja configurada con 10 etiquetas para imprimir');
}

function rebuildPrintItems() {
  const copies = state.printCopies || 1;
  const items = [];
  (state.basePrintItems || []).forEach(item => {
    for (let i = 0; i < copies; i++) {
      items.push(item);
    }
  });
  state.currentPrintItems = items;
  document.getElementById('print-sheet-count').textContent = state.currentPrintItems.length;
  const pages = Math.ceil(state.currentPrintItems.length / 10) || 1;
  document.getElementById('print-pages-count').textContent = pages;
  regeneratePrintLabels();
}

function regeneratePrintLabels() {
  const codeType = document.getElementById('print-code-type')?.value || 'barcode'; // 'barcode', 'qr', 'both'
  const codeSource = document.getElementById('print-code-source')?.value || 'auto'; // 'auto', 'interno', 'oficial'
  const container = document.getElementById('print-sheet-area');
  container.innerHTML = '';

  if (state.currentPrintItems.length === 0) {
    container.innerHTML = `
      <div class="col-span-1 sm:col-span-2 py-10 text-center text-slate-400 no-print">
        <i class="fa-solid fa-file-circle-exclamation text-3xl text-slate-300 mb-2"></i>
        <p class="font-medium text-slate-600 text-xs">No hay etiquetas para previsualizar</p>
        <p class="text-[11px] text-slate-400 mt-0.5">Agrega activos a la cola o selecciónalos desde la tabla.</p>
      </div>
    `;
    return;
  }

  state.currentPrintItems.forEach((item, idx) => {
    const card = document.createElement('div');
    const borderClass = state.borderStyle === 'dashed' ? 'border-dashed border-2 border-slate-400' :
                        state.borderStyle === 'none' ? 'border-none' :
                        'border-solid border border-emerald-800/80';
    // Esquinas cuadradas (rounded-none) para corte recto con tijeras o guillotina
    card.className = `label-card ${borderClass} bg-white rounded-none p-1.5 shadow-xs flex flex-col justify-between text-xs`;
    card.style.height = '48mm';
    card.style.maxHeight = '48mm';
    card.style.borderRadius = '0px';

    // Determinar valor a codificar según el selector (oficial, interno o auto)
    let codeValue = item.codigo_interno;
    let isOfficialUsed = false;

    if (codeSource === 'oficial') {
      if (item.codigo_oficial) {
        codeValue = item.codigo_oficial;
        isOfficialUsed = true;
      } else {
        codeValue = item.codigo_interno;
        isOfficialUsed = false;
      }
    } else if (codeSource === 'auto') {
      if (item.codigo_oficial) {
        codeValue = item.codigo_oficial;
        isOfficialUsed = true;
      } else {
        codeValue = item.codigo_interno;
        isOfficialUsed = false;
      }
    } else { // 'interno'
      codeValue = item.codigo_interno;
      isOfficialUsed = false;
    }

    // 1. CUERPO PRINCIPAL: LOGO AL LADO DEL CÓDIGO (MAXIMIZANDO ALTURA Y ESPACIO)
    let mainBodyHtml = '';

    if (codeType === 'barcode') {
      mainBodyHtml = `
        <div class="flex items-center justify-between gap-2 h-[35mm] overflow-hidden px-0.5">
          <!-- Logo Plantel 3 -->
          <div class="flex flex-col items-center justify-center flex-shrink-0">
            <img src="/assets/logo_halcon_oficial.png" alt="Halcón Plantel 3" class="h-[29mm] max-h-[29mm] w-auto object-contain">
            <span class="text-[7px] font-black text-emerald-950 uppercase tracking-tighter leading-none mt-0.5">PLANTEL 3</span>
          </div>
          <!-- Código de Barras Amplio y Alto -->
          <div class="flex-1 flex items-center justify-center min-w-0 h-full overflow-hidden">
            <svg id="barcode-svg-${idx}" class="w-full h-full max-h-[35mm]"></svg>
          </div>
        </div>
      `;
    } else if (codeType === 'qr') {
      mainBodyHtml = `
        <div class="flex items-center justify-between gap-2.5 h-[35mm] overflow-hidden px-0.5">
          <!-- Logo Plantel 3 -->
          <div class="flex flex-col items-center justify-center flex-shrink-0">
            <img src="/assets/logo_halcon_oficial.png" alt="Halcón Plantel 3" class="h-[29mm] max-h-[29mm] w-auto object-contain">
            <span class="text-[7px] font-black text-emerald-950 uppercase tracking-tighter leading-none mt-0.5">PLANTEL 3</span>
          </div>
          <!-- QR y Códigos en Grande -->
          <div class="flex-1 flex items-center justify-center gap-3 min-w-0">
            <div id="qr-div-${idx}" class="flex-shrink-0"></div>
            <div class="flex flex-col justify-center min-w-0 text-left">
              <div class="font-mono font-black text-lg sm:text-xl text-slate-900 leading-tight tracking-tight">${isOfficialUsed ? `#${item.codigo_oficial}` : item.codigo_interno}</div>
              ${item.codigo_oficial ? `<div class="text-[11px] font-bold text-emerald-700 mt-0.5">${isOfficialUsed ? `INT: ${item.codigo_interno}` : `OFICIAL: #${item.codigo_oficial}`}</div>` : '<div class="text-[9.5px] font-bold text-amber-600 mt-0.5">PROVISIONAL</div>'}
              <div class="text-[8.5px] font-bold text-slate-500 uppercase mt-0.5">${item.origen}</div>
            </div>
          </div>
        </div>
      `;
    } else { // both
      mainBodyHtml = `
        <div class="flex items-center justify-between gap-2 h-[34mm] overflow-hidden px-0.5">
          <!-- Logo Plantel 3 -->
          <div class="flex flex-col items-center justify-center flex-shrink-0 h-[30mm]">
            <img src="/assets/logo_halcon_oficial.png" alt="Halcón Plantel 3" class="h-[25mm] max-h-[25mm] w-auto object-contain">
            <span class="text-[6.5px] font-black text-emerald-950 uppercase tracking-tighter leading-none mt-0.5">PLANTEL 3</span>
          </div>
          <!-- Código de Barras (Centro) -->
          <div class="flex-1 flex items-center justify-center min-w-0 h-[30mm] overflow-hidden">
            <svg id="barcode-svg-${idx}" class="h-[29mm] max-h-[29mm] w-auto max-w-full"></svg>
          </div>
          <!-- Código QR (Derecha) emparejado en altura -->
          <div id="qr-div-${idx}" class="qr-box flex-shrink-0 flex items-center justify-center h-[29mm] w-[29mm]"></div>
        </div>
      `;
    }

    // 2. PIE DE ETIQUETA: INFORMACIÓN ADICIONAL A LO ANCHO Y ABAJO (COMPACTA)
    const bottomInfoHtml = `
      <div class="border-t border-slate-300 pt-0.5 mt-0.5 text-slate-800 leading-none">
        <div class="font-black text-slate-950 text-[10px] uppercase truncate tracking-tight leading-tight">${escapeHtml(item.descripcion)}</div>
        <div class="flex items-center justify-between text-slate-600 text-[8.5px] mt-0.5 font-medium leading-none">
          <span class="font-mono"><strong class="text-slate-500">SERIE:</strong> ${item.numero_serie ? escapeHtml(item.numero_serie) : 'S/N'}</span>
          <span class="font-bold text-emerald-900 uppercase truncate max-w-[45%]">${item.ubicacion ? escapeHtml(item.ubicacion) : 'PLANTEL 3'}</span>
          <span class="font-bold text-slate-500">${item.origen}</span>
        </div>
      </div>
    `;

    card.innerHTML = mainBodyHtml + bottomInfoHtml;
    container.appendChild(card);

    // Renderizar código de barras si aplica
    if (codeType === 'barcode' || codeType === 'both') {
      try {
        const barHeight = codeType === 'both' ? 48 : 50;
        const barWidth = codeType === 'both' ? 1.3 : 1.75;
        const barFontSize = codeType === 'both' ? 11 : 12;
        JsBarcode(`#barcode-svg-${idx}`, codeValue, {
          format: "CODE128",
          width: barWidth,
          height: barHeight,
          displayValue: true,
          fontSize: barFontSize,
          font: "monospace",
          textMargin: 2,
          margin: 0
        });
      } catch (e) {
        console.error('Error generando código de barras:', e);
      }
    }

    // Renderizar código QR si aplica
    if (codeType === 'qr' || codeType === 'both') {
      try {
        const qrContainer = document.getElementById(`qr-div-${idx}`);
        if (qrContainer) {
          qrContainer.innerHTML = '';
          const qrSize = codeType === 'both' ? 110 : 100;
          new QRCode(qrContainer, {
            text: `COBACH-PL3:${codeValue}${item.codigo_oficial && !isOfficialUsed ? `:${item.codigo_oficial}` : ''}`,
            width: qrSize,
            height: qrSize,
            colorDark: '#064e3b',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      } catch (e) {
        console.error('Error generando QR:', e);
      }
    }
  });
}

// Toast
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const text = document.getElementById('toast-msg');

  text.textContent = msg;
  if (isError) {
    icon.className = 'fa-solid fa-circle-exclamation text-red-400 text-base';
  } else {
    icon.className = 'fa-solid fa-circle-check text-emerald-400 text-base';
  }

  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// MÓDULO DE EXPORTACIÓN A EXCEL (.xlsx)
// ==========================================
function getSelectedExportCols() {
  const checked = document.querySelectorAll('input[name="export-col"]:checked');
  const cols = Array.from(checked).map(cb => cb.value);
  return cols.join(',');
}

function selectAllExportCols(checked) {
  document.querySelectorAll('input[name="export-col"]').forEach(cb => {
    cb.checked = checked;
  });
}

function selectDefaultExportCols() {
  const defaultCols = new Set([
    'codigo_interno', 'codigo_oficial', 'descripcion', 'especificacion',
    'marca', 'modelo', 'numero_serie', 'ubicacion', 'categoria',
    'resguardante', 'origen', 'condicion_dg', 'condicion_actual',
    'costo', 'estatus_activo', 'observaciones'
  ]);
  document.querySelectorAll('input[name="export-col"]').forEach(cb => {
    cb.checked = defaultCols.has(cb.value);
  });
}

function openExportModal() {
  const modal = document.getElementById('modal-export');
  const optFiltered = document.getElementById('export-opt-filtered');
  const filteredTitle = document.getElementById('export-filtered-title');
  const filteredDesc = document.getElementById('export-filtered-desc');
  const optQueue = document.getElementById('export-opt-queue');
  const queueCountEl = document.getElementById('export-queue-count');

  // Detectar si hay filtros activos
  const hasFilter = Boolean(
    state.tab || 
    (state.q && state.q.trim()) || 
    state.ubicacion_id || 
    state.categoria_id || 
    state.estatus_activo
  );

  if (hasFilter) {
    optFiltered.classList.remove('hidden');
    let filterLabel = state.tab ? `Sección: ${state.tab}` : '';
    if (state.q && state.q.trim()) filterLabel += (filterLabel ? ' + ' : '') + `"${state.q.trim()}"`;
    if (state.tab === 'PENDIENTES') filterLabel += ' (Pendientes)';

    filteredTitle.textContent = `Exportar Vista Filtrada (${(state.totalItems || 0).toLocaleString()} activos)`;
    filteredDesc.textContent = `Descarga únicamente los registros que cumplen: ${filterLabel || 'Filtro actual'}`;
  } else {
    optFiltered.classList.add('hidden');
  }

  // Opción de cola si hay elementos (state.printQueue es un Map)
  const queueSize = state.printQueue ? state.printQueue.size : 0;
  if (queueSize > 0) {
    optQueue.classList.remove('hidden');
    queueCountEl.textContent = queueSize;
  } else {
    optQueue.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

function closeExportModal() {
  const modal = document.getElementById('modal-export');
  if (modal) modal.classList.add('hidden');
}

async function downloadExcelUrl(url) {
  try {
    const res = await authFetch(url);
    if (!res.ok) throw new Error('Error al generar el archivo Excel');
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    let filename = 'BienesMuebles_COBACH3.xlsx';
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) filename = match[1];

    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
    showToast('Archivo Excel descargado correctamente');
  } catch (err) {
    console.error('Error descargando Excel:', err);
    showToast('Error al descargar el archivo Excel', true);
  }
}

function downloadExcelAll() {
  closeExportModal();
  showToast('Generando reporte completo de inventario...');
  const cols = getSelectedExportCols();
  const url = cols ? `/api/export/excel?columnas=${encodeURIComponent(cols)}` : '/api/export/excel';
  downloadExcelUrl(url);
}

function downloadExcelFiltered() {
  closeExportModal();
  const params = new URLSearchParams();
  if (state.q && state.q.trim()) params.append('q', state.q.trim());
  if (state.tab === 'GASTO') {
    params.append('origen', 'GASTO');
    params.append('scope', 'GASTO');
  } else if (state.tab === 'CONTROL ADMINISTRATIVO' || state.tab === 'C.A.') {
    params.append('origen', 'CONTROL ADMINISTRATIVO');
    params.append('scope', 'CONTROL ADMINISTRATIVO');
  } else if (state.tab === 'DIRECCION GENERAL' || state.tab === 'CENTRAL') {
    params.append('origen', 'DIRECCION GENERAL');
    params.append('scope', 'DIRECCION GENERAL');
  } else if (state.tab === 'PENDIENTES') {
    params.append('estatus_etiqueta', 'PENDIENTE_ETIQUETA');
    params.append('scope', 'PENDIENTES');
  }

  if (state.ubicacion_id) params.append('ubicacion_id', state.ubicacion_id);
  if (state.categoria_id) params.append('categoria_id', state.categoria_id);
  if (state.estatus_activo) params.append('estatus_activo', state.estatus_activo);

  const cols = getSelectedExportCols();
  if (cols) params.append('columnas', cols);

  showToast(`Generando reporte filtrado (${state.totalItems || 0} activos)...`);
  downloadExcelUrl('/api/export/excel?' + params.toString());
}

function exportSelectedToExcel() {
  if (state.selectedIds.size === 0) {
    showToast('Selecciona al menos un activo con las casillas', true);
    return;
  }
  const ids = Array.from(state.selectedIds).join(',');
  const cols = getSelectedExportCols();
  const colParam = cols ? `&columnas=${encodeURIComponent(cols)}` : '';
  showToast(`Descargando ${state.selectedIds.size} activos seleccionados en Excel...`);
  downloadExcelUrl(`/api/export/excel?ids=${ids}&scope=SELECCION${colParam}`);
}

function exportQueueToExcel() {
  const queueSize = state.printQueue ? state.printQueue.size : 0;
  if (queueSize === 0) {
    showToast('La cola de impresión no tiene activos acumulados', true);
    return;
  }
  closeExportModal();
  const ids = Array.from(state.printQueue.keys()).join(',');
  const cols = getSelectedExportCols();
  const colParam = cols ? `&columnas=${encodeURIComponent(cols)}` : '';
  showToast(`Descargando ${queueSize} activos de la cola en Excel...`);
  downloadExcelUrl(`/api/export/excel?ids=${ids}&scope=COLA${colParam}`);
}

// -------------------------------------------------------------
// VISOR DE IMÁGENES EN ALTA RESOLUCIÓN (LIGHTBOX)
// -------------------------------------------------------------
function openLightbox(url, caption, code, isCustom) {
  const modal = document.getElementById('modal-lightbox');
  const img = document.getElementById('lightbox-img');
  const captionEl = document.getElementById('lightbox-caption');
  const badgeEl = document.getElementById('lightbox-badge');
  const downloadBtn = document.getElementById('lightbox-download');

  img.src = url;
  captionEl.textContent = caption || 'Fotografía de Activo';
  
  if (isCustom) {
    badgeEl.textContent = 'Foto particular / daño físico';
    badgeEl.className = 'ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
  } else {
    badgeEl.textContent = 'Foto de catálogo / modelo';
    badgeEl.className = 'ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-300 border border-slate-600';
  }

  downloadBtn.href = url;
  downloadBtn.setAttribute('download', `activo_${code || 'foto'}.jpg`);
  modal.classList.remove('hidden');
}

function closeLightbox() {
  const modal = document.getElementById('modal-lightbox');
  if (modal) modal.classList.add('hidden');
}

// -------------------------------------------------------------
// SUBIDA Y GESTIÓN DE FOTOGRAFÍAS
// -------------------------------------------------------------
function openImageUploadModal(activoId, desc, modelo) {
  document.getElementById('upload-activo-id').value = activoId;
  document.getElementById('upload-modal-subtitle').textContent = desc;
  document.getElementById('input-image-file').value = '';
  document.getElementById('dropzone-empty').classList.remove('hidden');
  document.getElementById('dropzone-preview-container').classList.add('hidden');
  document.getElementById('upload-error').classList.add('hidden');

  const propagateContainer = document.getElementById('upload-propagate-container');
  const modelNameEl = document.getElementById('upload-model-name');
  const checkPropagate = document.getElementById('check-propagate-model');

  if (modelo && modelo.trim()) {
    modelNameEl.textContent = `"${modelo.trim()}"`;
    checkPropagate.checked = true; // Marcado por defecto
    propagateContainer.classList.remove('hidden');
  } else {
    checkPropagate.checked = false;
    propagateContainer.classList.add('hidden');
  }

  document.getElementById('modal-image-upload').classList.remove('hidden');
}

function closeImageUploadModal() {
  const modal = document.getElementById('modal-image-upload');
  if (modal) modal.classList.add('hidden');
}

function previewSelectedImage(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const previewImg = document.getElementById('dropzone-preview');
    previewImg.src = e.target.result;
    document.getElementById('dropzone-empty').classList.add('hidden');
    document.getElementById('dropzone-preview-container').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function submitImageUpload(e) {
  e.preventDefault();
  const activoId = document.getElementById('upload-activo-id').value;
  const fileInput = document.getElementById('input-image-file');
  const errorDiv = document.getElementById('upload-error');
  const btnSave = document.getElementById('btn-save-image');
  const propagate = document.getElementById('check-propagate-model').checked;

  if (!fileInput.files || fileInput.files.length === 0) {
    errorDiv.textContent = 'Por favor selecciona o arrastra una imagen antes de guardar.';
    errorDiv.classList.remove('hidden');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('propagate_model', propagate ? 'true' : 'false');
  formData.append('override_custom', 'false'); // BLINDAJE: nunca sobreescribir fotos particulares

  errorDiv.classList.add('hidden');
  btnSave.disabled = true;
  btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Subiendo...';

  try {
    const res = await authFetch(`/api/activos/${activoId}/imagen`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al subir la fotografía');

    closeImageUploadModal();
    showToast(data.mensaje || 'Fotografía guardada con éxito');

    // Recargar modal de detalle si está abierto
    const detailModal = document.getElementById('modal-detail');
    if (detailModal && !detailModal.classList.contains('hidden')) {
      openDetailModal(activoId);
    }
    await loadActivos();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove('hidden');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="fa-solid fa-upload"></i> Subir Foto';
  }
}

async function removeActivoPhoto(activoId) {
  if (!confirm('¿Deseas quitar la fotografía asignada a este activo?')) return;

  try {
    const res = await authFetch(`/api/activos/${activoId}/imagen`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error al eliminar la foto');

    showToast('Fotografía eliminada');
    openDetailModal(activoId);
    await loadActivos();
  } catch (err) {
    showToast(err.message, true);
  }
}

// -------------------------------------------------------------
// MODAL: ACTUALIZAR CONDICIÓN / REPORTAR DESUSO (RESGUARDO / DOCENTES)
// -------------------------------------------------------------
function openCondicionModal(id, desc, condActual, estatusActivo, ubicacion) {
  document.getElementById('condicion-activo-id').value = id;
  document.getElementById('condicion-codigo-badge').textContent = `Activo #${id}`;
  document.getElementById('condicion-activo-desc').textContent = desc;
  document.getElementById('condicion-activo-ubi-text').textContent = ubicacion || 'Sin ubicación física asignada';

  const statusBadge = document.getElementById('condicion-status-badge');
  statusBadge.textContent = estatusActivo || 'OPERATIVO';
  statusBadge.className = `text-[10px] font-bold px-1.5 py-0.5 rounded ${
    estatusActivo === 'EN_DESUSO' ? 'bg-red-100 text-red-800' :
    estatusActivo === 'EN_REPARACION' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
  }`;

  const selectCond = document.getElementById('select-condicion-actual');
  if (condActual && selectCond.querySelector(`option[value="${condActual}"]`)) {
    selectCond.value = condActual;
  } else {
    selectCond.value = 'Buena 61% - 80%';
  }

  document.getElementById('select-nuevo-estatus').value = '';
  document.getElementById('textarea-condicion-obs').value = '';
  document.getElementById('condicion-error').classList.add('hidden');
  document.getElementById('modal-condicion-resguardo').classList.remove('hidden');
}

function closeCondicionModal() {
  document.getElementById('modal-condicion-resguardo').classList.add('hidden');
}

async function submitCondicionResguardo(e) {
  e.preventDefault();
  const id = document.getElementById('condicion-activo-id').value;
  const condicion = document.getElementById('select-condicion-actual').value;
  const nuevoEstatus = document.getElementById('select-nuevo-estatus').value;
  const obs = document.getElementById('textarea-condicion-obs').value.trim();
  const errorDiv = document.getElementById('condicion-error');
  const btnSubmit = document.getElementById('btn-save-condicion');

  errorDiv.classList.add('hidden');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Guardando...';

  try {
    const payload = {
      condicion_actual: condicion,
      observaciones: obs || null
    };
    if (nuevoEstatus) {
      payload.nuevo_estatus = nuevoEstatus;
    }

    const res = await authFetch(`/api/activos/${id}/condicion`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Error al guardar condición');
    }

    closeCondicionModal();
    showToast('Reporte de condición y estatus guardado con éxito');
    await loadActivos();
    await loadStats();
  } catch (err) {
    errorDiv.classList.remove('hidden');
    errorDiv.textContent = err.message || 'Error al guardar reporte';
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<i class="fa-solid fa-check"></i> Guardar Reporte';
  }
}

function switchFromCondicionToPhoto() {
  const id = document.getElementById('condicion-activo-id').value;
  const desc = document.getElementById('condicion-activo-desc').textContent;
  closeCondicionModal();
  openImageUploadModal(id, desc, '');
}

