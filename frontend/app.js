// Estado global de la aplicación
const state = {
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

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  loadQueueFromStorage();
  await Promise.all([
    loadStats(),
    loadCatalogos()
  ]);
  await loadActivos();
});

// Cargar estadísticas KPI
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
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
    const res = await fetch('/api/catalogos');
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
      <td colspan="9" class="py-12 text-center text-slate-400">
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
  } else if (state.tab === 'C.A.') {
    params.append('origen', 'C.A.');
  } else if (state.tab === 'CENTRAL') {
    params.append('origen', 'CENTRAL');
  } else if (state.tab === 'PENDIENTES') {
    params.append('estatus_etiqueta', 'PENDIENTE_ETIQUETA');
  }

  try {
    const res = await fetch(`/api/activos?${params.toString()}`);
    if (!res.ok) throw new Error('Error en la petición');
    const data = await res.json();

    state.totalPages = data.total_pages;
    state.totalItems = data.total;

    updatePaginationUI();
    renderTable(data.items);
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-8 text-center text-red-500 font-medium">
          <i class="fa-solid fa-circle-exclamation text-xl mb-1"></i>
          <p>Ocurrió un error al consultar los activos.</p>
        </td>
      </tr>
    `;
    console.error(err);
  }
}

// Renderizar filas de la tabla
function renderTable(items) {
  const tbody = document.getElementById('activos-table-body');
  
  if (!items || items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-12 text-center text-slate-400">
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

    let origenBadge = '';
    if (item.origen === 'GASTO') {
      origenBadge = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold badge-gasto">GASTO</span>';
    } else if (item.origen === 'C.A.') {
      origenBadge = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold badge-ca">C.A.</span>';
    } else if (item.origen === 'CENTRAL') {
      origenBadge = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold badge-central">CENTRAL</span>';
    } else {
      origenBadge = '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold badge-auditorio">AUDITORIO</span>';
    }

    let tagBadge = '';
    let btnAsignarTag = '';
    if (item.estatus_etiqueta === 'ETIQUETADO_OFICIAL' && item.codigo_oficial) {
      tagBadge = `
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <i class="fa-solid fa-tag mr-1 text-emerald-600 text-[10px]"></i> ${item.codigo_oficial}
        </span>
      `;
    } else {
      tagBadge = `
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
          <i class="fa-solid fa-triangle-exclamation mr-1 text-amber-600 text-[10px]"></i> Pendiente
        </span>
      `;
      btnAsignarTag = `
        <button 
          onclick="openTagModal(${item.id}, '${item.codigo_interno}', '${escapeHtml(item.descripcion)}')"
          title="Registrar Etiqueta Verde Oficial" 
          class="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition"
        >
          <i class="fa-solid fa-tag"></i>
        </button>
      `;
    }

    let estatusFisicoBadge = '';
    if (item.estatus_activo === 'OPERATIVO') {
      estatusFisicoBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Operativo</span>';
    } else if (item.estatus_activo === 'EN_DESUSO') {
      estatusFisicoBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-red-800 bg-red-50 px-2 py-0.5 rounded-md border border-red-200"><span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> En Desuso</span>';
    } else if (item.estatus_activo === 'EN_REPARACION') {
      estatusFisicoBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Reparación</span>';
    } else {
      estatusFisicoBadge = '<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">Baja Oficial</span>';
    }

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="py-3 px-3 text-center">
          <input type="checkbox" class="row-checkbox rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" data-id="${item.id}" ${isChecked} onchange="toggleRowSelection(${item.id}, this)">
        </td>
        <td class="py-3 px-4 font-mono font-bold text-slate-800 text-xs">${item.codigo_interno}</td>
        <td class="py-3 px-4">${tagBadge}</td>
        <td class="py-3 px-4">
          <div class="font-bold text-slate-800">${escapeHtml(item.descripcion)}</div>
          <div class="text-[11px] text-slate-500">
            ${item.marca ? `<span class="font-medium text-slate-600">${escapeHtml(item.marca)}</span>` : ''}
            ${item.modelo ? `<span class="text-slate-400">· ${escapeHtml(item.modelo)}</span>` : ''}
          </div>
        </td>
        <td class="py-3 px-4 text-xs font-mono text-slate-600">
          ${item.numero_serie ? escapeHtml(item.numero_serie) : '<span class="text-slate-300 italic">S/N</span>'}
        </td>
        <td class="py-3 px-4 text-xs text-slate-600">
          <div class="flex items-center gap-1.5">
            <i class="fa-solid fa-location-dot text-slate-400 text-[10px]"></i>
            <span class="font-medium">${item.ubicacion ? escapeHtml(item.ubicacion) : 'No asignada'}</span>
          </div>
        </td>
        <td class="py-3 px-4">${estatusFisicoBadge}</td>
        <td class="py-3 px-4">${origenBadge}</td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center space-x-1">
            <button 
              onclick="openDetailModal(${item.id})"
              title="Ver detalle completo"
              class="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition"
            >
              <i class="fa-solid fa-circle-info"></i>
            </button>
            <button 
              onclick="openEditModal(${item.id})"
              title="Editar datos del activo"
              class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
            >
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button 
              onclick="addSingleToQueue(${item.id})"
              title="Agregar a Cola de Impresión"
              class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
            >
              <i class="fa-solid fa-folder-plus"></i>
            </button>
            <button 
              onclick="openPrintSingle(${item.id})"
              title="Imprimir Etiqueta"
              class="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition"
            >
              <i class="fa-solid fa-print"></i>
            </button>
            ${btnAsignarTag}
            <button 
              onclick="openDeleteModal(${item.id}, '${escapeHtml(item.descripcion)}')"
              title="Eliminar activo"
              class="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
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
                   tabName === 'C.A.' ? 'tab-ca' :
                   tabName === 'PENDIENTES' ? 'tab-pendientes' : 'tab-central';

  const activeBtn = document.getElementById(activeId);
  if (activeBtn) {
    activeBtn.classList.remove('text-emerald-100', 'hover:bg-emerald-800/60');
    activeBtn.classList.add('bg-white', 'text-emerald-950', 'shadow');
  }

  loadActivos();
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
function openCreateModal() {
  document.getElementById('asset-form-id').value = '';
  document.getElementById('asset-form-title').textContent = 'Registrar Nuevo Activo';
  document.getElementById('asset-form-icon').className = 'fa-solid fa-plus-circle text-amber-400 text-lg';
  document.getElementById('btn-save-asset').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Registrar Activo';
  
  document.getElementById('form-origen').value = state.tab === 'C.A.' ? 'C.A.' : 'GASTO';
  document.getElementById('form-estatus-operativo').value = 'OPERATIVO';
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

  document.getElementById('modal-asset-form').classList.remove('hidden');
}

async function openEditModal(id) {
  try {
    const res = await fetch(`/api/activos/${id}`);
    if (!res.ok) throw new Error('No se pudo cargar el activo');
    const a = await res.json();

    document.getElementById('asset-form-id').value = a.id;
    document.getElementById('asset-form-title').textContent = `Editar Activo: ${a.codigo_interno}`;
    document.getElementById('asset-form-icon').className = 'fa-solid fa-pen-to-square text-amber-400 text-lg';
    document.getElementById('btn-save-asset').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Cambios';

    document.getElementById('form-origen').value = a.origen;
    document.getElementById('form-estatus-operativo').value = a.estatus_activo;
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

  const payload = {
    origen: document.getElementById('form-origen').value,
    estatus_operativo: document.getElementById('form-estatus-operativo').value,
    codigo_interno: document.getElementById('form-codigo-interno').value.trim() || null,
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

    const res = await fetch(url, {
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
    const res = await fetch(`/api/activos/${state.deletingId}`, { method: 'DELETE' });
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
    const res = await fetch(`/api/activos/${id}`);
    if (!res.ok) throw new Error('Error al cargar detalle');
    const a = await res.json();

    title.textContent = a.descripcion;
    badge.textContent = `${a.origen} · ${a.codigo_interno}`;
    badge.className = `text-[11px] font-bold px-2 py-0.5 rounded-md ${
      a.origen === 'GASTO' ? 'badge-gasto' :
      a.origen === 'C.A.' ? 'badge-ca' :
      a.origen === 'CENTRAL' ? 'badge-central' : 'badge-auditorio'
    }`;

    opBadge.textContent = a.estatus_activo;
    opBadge.className = `text-[11px] font-bold px-2 py-0.5 rounded-md ${
      a.estatus_activo === 'OPERATIVO' ? 'bg-emerald-100 text-emerald-800' :
      a.estatus_activo === 'EN_DESUSO' ? 'bg-red-100 text-red-800' :
      a.estatus_activo === 'EN_REPARACION' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'
    }`;

    actionsContainer.innerHTML = `
      <button onclick="addSingleToQueue(${a.id})" class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl text-xs transition flex items-center gap-1.5">
        <i class="fa-solid fa-folder-plus"></i> + Cola
      </button>
      <button onclick="closeDetailModal(); openEditModal(${a.id})" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs transition flex items-center gap-1.5">
        <i class="fa-solid fa-pen-to-square"></i> Editar
      </button>
      <button onclick="closeDetailModal(); openPrintSingle(${a.id})" class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-xl text-xs transition flex items-center gap-1.5">
        <i class="fa-solid fa-print"></i> Imprimir Etiqueta
      </button>
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
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
        <div>
          <span class="text-slate-400 block uppercase tracking-wider text-[10px]">Código Interno</span>
          <span class="font-mono font-bold text-slate-800">${a.codigo_interno}</span>
        </div>
        <div>
          <span class="text-slate-400 block uppercase tracking-wider text-[10px]">Etiqueta Verde</span>
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
          <span class="text-slate-400 block uppercase text-[10px]">Condición del Bien</span>
          <span class="font-semibold text-slate-800">${a.condicion || '-'}</span>
        </div>
      </div>

      ${a.observaciones ? `
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Observaciones</h4>
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
    const res = await fetch(`/api/activos/${activoId}/asignar-etiqueta`, {
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
      const res = await fetch(`/api/activos/${id}`);
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
      return fetch(`/api/activos/${id}`).then(r => r.json()).then(activo => {
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

    const res = await fetch(`/api/activos?${params.toString()}`);
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
    const res = await fetch(`/api/activos/${id}`);
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
    const promises = ids.map(id => fetch(`/api/activos/${id}`).then(r => r.json()));
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
  rebuildPrintItems();
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
  const codeType = document.getElementById('print-code-type').value; // 'barcode', 'qr', 'both'
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
    card.className = `label-card ${borderClass} bg-white rounded-lg p-1.5 shadow-sm flex flex-col justify-between text-xs`;
    card.style.height = '48mm';
    card.style.maxHeight = '48mm';

    // Texto del código a codificar (código oficial si tiene, o código interno)
    const codeValue = item.codigo_oficial || item.codigo_interno;

    // 1. CUERPO PRINCIPAL: LOGO AL LADO DEL CÓDIGO (MAXIMIZANDO ALTURA Y ESPACIO)
    let mainBodyHtml = '';

    if (codeType === 'barcode') {
      mainBodyHtml = `
        <div class="flex items-center justify-between gap-2 h-[35mm] overflow-hidden px-0.5">
          <!-- Logo Plantel 3 -->
          <div class="flex flex-col items-center justify-center flex-shrink-0">
            <img src="/assets/logo_plantel3_halcon_cuerpo_completo.png" alt="Halcón Plantel 3" class="h-[31mm] max-h-[31mm] w-auto object-contain">
            <span class="text-[7.5px] font-black text-emerald-950 uppercase tracking-tighter leading-none mt-0.5">COBACH 3</span>
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
            <img src="/assets/logo_plantel3_halcon_cuerpo_completo.png" alt="Halcón Plantel 3" class="h-[31mm] max-h-[31mm] w-auto object-contain">
            <span class="text-[7.5px] font-black text-emerald-950 uppercase tracking-tighter leading-none mt-0.5">COBACH 3</span>
          </div>
          <!-- QR y Códigos en Grande -->
          <div class="flex-1 flex items-center justify-center gap-3 min-w-0">
            <div id="qr-div-${idx}" class="flex-shrink-0"></div>
            <div class="flex flex-col justify-center min-w-0 text-left">
              <div class="font-mono font-black text-lg sm:text-xl text-slate-900 leading-tight tracking-tight">${item.codigo_interno}</div>
              ${item.codigo_oficial ? `<div class="text-sm font-bold text-emerald-700 mt-1">OFICIAL: #${item.codigo_oficial}</div>` : '<div class="text-[9.5px] font-bold text-amber-600 mt-1">PROVISIONAL</div>'}
              <div class="text-[8.5px] font-bold text-slate-500 uppercase mt-1">${item.origen}</div>
            </div>
          </div>
        </div>
      `;
    } else { // both
      mainBodyHtml = `
        <div class="flex items-center justify-between gap-1.5 h-[35mm] overflow-hidden px-0.5">
          <!-- Logo Plantel 3 -->
          <div class="flex flex-col items-center justify-center flex-shrink-0">
            <img src="/assets/logo_plantel3_halcon_cuerpo_completo.png" alt="Halcón Plantel 3" class="h-[29mm] max-h-[29mm] w-auto object-contain">
            <span class="text-[7px] font-black text-emerald-950 uppercase tracking-tighter leading-none mt-0.5">COBACH 3</span>
          </div>
          <!-- Código de Barras (Centro) -->
          <div class="flex-1 flex items-center justify-center min-w-0 h-full overflow-hidden">
            <svg id="barcode-svg-${idx}" class="w-full h-full max-h-[35mm]"></svg>
          </div>
          <!-- Código QR (Derecha) -->
          <div id="qr-div-${idx}" class="flex-shrink-0 flex items-center justify-center"></div>
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
        const barHeight = codeType === 'both' ? 42 : 50;
        const barWidth = codeType === 'both' ? 1.35 : 1.75;
        const barFontSize = codeType === 'both' ? 10 : 12;
        JsBarcode(`#barcode-svg-${idx}`, codeValue, {
          format: "CODE128",
          width: barWidth,
          height: barHeight,
          displayValue: true,
          fontSize: barFontSize,
          font: "monospace",
          textMargin: 1,
          margin: 0
        });
      } catch (e) {
        console.error('Error generando código de barras:', e);
      }
    }

    // Renderizar código QR si aplica
    if (codeType === 'qr' || codeType === 'both') {
      try {
        const qrSize = codeType === 'both' ? 76 : 88;
        new QRCode(document.getElementById(`qr-div-${idx}`), {
          text: `COBACH-PL3:${item.codigo_interno}${item.codigo_oficial ? `:${item.codigo_oficial}` : ''}`,
          width: qrSize,
          height: qrSize,
          colorDark: '#064e3b',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
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
