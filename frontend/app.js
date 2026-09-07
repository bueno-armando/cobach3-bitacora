// Estado global de la aplicación
const state = {
  tab: '', // '' (Todos), 'GASTO', 'C.A.', 'PENDIENTES', 'CENTRAL'
  q: '',
  ubicacion_id: '',
  categoria_id: '',
  page: 1,
  limit: 50,
  totalPages: 1,
  totalItems: 0
};

// Inicialización al cargar la página
document.addEventListener('DOMContentLoaded', async () => {
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

// Cargar listas desplegables de catálogos
async function loadCatalogos() {
  try {
    const res = await fetch('/api/catalogos');
    if (!res.ok) return;
    const data = await res.json();

    const selectUbi = document.getElementById('filter-ubicacion');
    data.ubicaciones.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.nombre;
      selectUbi.appendChild(opt);
    });

    const selectCat = document.getElementById('filter-categoria');
    data.categorias.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nombre;
      selectCat.appendChild(opt);
    });
  } catch (err) {
    console.error('Error cargando catálogos:', err);
  }
}

// Cargar y renderizar la lista de activos
async function loadActivos() {
  const tbody = document.getElementById('activos-table-body');
  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="py-12 text-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-emerald-600"></i>
        <p>Buscando activos en la base de datos...</p>
      </td>
    </tr>
  `;

  // Construir parámetros de consulta
  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit
  });

  if (state.q.trim()) {
    params.append('q', state.q.trim());
  }

  if (state.ubicacion_id) {
    params.append('ubicacion_id', state.ubicacion_id);
  }

  if (state.categoria_id) {
    params.append('categoria_id', state.categoria_id);
  }

  // Filtrado según la pestaña activa
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
        <td colspan="7" class="py-8 text-center text-red-500 font-medium">
          <i class="fa-solid fa-circle-exclamation text-xl mb-1"></i>
          <p>Ocurrió un error al consultar el inventario.</p>
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
        <td colspan="7" class="py-12 text-center text-slate-400">
          <i class="fa-solid fa-box-open text-3xl mb-2 text-slate-300"></i>
          <p class="font-medium text-slate-600">No se encontraron activos con los filtros seleccionados.</p>
          <p class="text-xs text-slate-400 mt-1">Intenta con otro término de búsqueda o limpia los filtros.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(item => {
    // Badge de origen
    let origenBadge = '';
    if (item.origen === 'GASTO') {
      origenBadge = '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold badge-gasto">GASTO</span>';
    } else if (item.origen === 'C.A.') {
      origenBadge = '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold badge-ca">C.A.</span>';
    } else if (item.origen === 'CENTRAL') {
      origenBadge = '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold badge-central">CENTRAL</span>';
    } else {
      origenBadge = '<span class="px-2 py-0.5 rounded-md text-[11px] font-bold badge-auditorio">AUDITORIO</span>';
    }

    // Badge de etiqueta oficial verde
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
          title="Registrar Etiqueta Verde" 
          class="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition"
        >
          <i class="fa-solid fa-tag"></i>
        </button>
      `;
    }

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="py-3 px-4 font-mono font-bold text-slate-700 text-xs">${item.codigo_interno}</td>
        <td class="py-3 px-4">${tagBadge}</td>
        <td class="py-3 px-4">
          <div class="font-semibold text-slate-800">${escapeHtml(item.descripcion)}</div>
          <div class="text-xs text-slate-500">
            ${item.marca ? `<span class="font-medium text-slate-600">${escapeHtml(item.marca)}</span>` : ''}
            ${item.modelo ? `<span class="text-slate-400">· ${escapeHtml(item.modelo)}</span>` : ''}
          </div>
        </td>
        <td class="py-3 px-4 text-xs font-mono text-slate-600">
          ${item.numero_serie ? escapeHtml(item.numero_serie) : '<span class="text-slate-400 italic">S/N</span>'}
        </td>
        <td class="py-3 px-4 text-xs text-slate-600">
          <div class="flex items-center gap-1.5">
            <i class="fa-solid fa-location-dot text-slate-400 text-[10px]"></i>
            <span class="font-medium">${item.ubicacion ? escapeHtml(item.ubicacion) : 'No especificada'}</span>
          </div>
        </td>
        <td class="py-3 px-4">${origenBadge}</td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center space-x-1">
            <button 
              onclick="openDetailModal(${item.id})"
              title="Ver detalle completo"
              class="p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition"
            >
              <i class="fa-solid fa-circle-info"></i>
            </button>
            ${btnAsignarTag}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Actualizar controles de paginación y texto resumen
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
}

// Cambio de pestañas principales (GASTO, C.A., etc.)
function setTab(tabName) {
  state.tab = tabName;
  state.page = 1;

  // Actualizar estilos visuales de los botones de pestañas
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-white', 'text-emerald-900', 'shadow');
    btn.classList.add('text-emerald-100', 'hover:bg-emerald-800/60');
  });

  const activeId = tabName === '' ? 'tab-all' :
                   tabName === 'GASTO' ? 'tab-gasto' :
                   tabName === 'C.A.' ? 'tab-ca' :
                   tabName === 'PENDIENTES' ? 'tab-pendientes' : 'tab-central';

  const activeBtn = document.getElementById(activeId);
  if (activeBtn) {
    activeBtn.classList.remove('text-emerald-100', 'hover:bg-emerald-800/60');
    activeBtn.classList.add('bg-white', 'text-emerald-900', 'shadow');
  }

  loadActivos();
}

// Aplicar filtros de la barra superior
function applyFilters() {
  const searchInput = document.getElementById('search-input');
  state.q = searchInput.value;
  state.ubicacion_id = document.getElementById('filter-ubicacion').value;
  state.categoria_id = document.getElementById('filter-categoria').value;
  state.page = 1;

  const clearBtn = document.getElementById('clear-search-btn');
  if (state.q.trim()) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }

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
  document.getElementById('clear-search-btn').classList.add('hidden');
  state.q = '';
  state.ubicacion_id = '';
  state.categoria_id = '';
  state.page = 1;
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

// Modal de Detalle
async function openDetailModal(id) {
  const modal = document.getElementById('modal-detail');
  const content = document.getElementById('modal-detail-content');
  const title = document.getElementById('modal-detail-title');
  const badge = document.getElementById('modal-detail-badge');

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
    badge.className = `text-xs font-bold px-2 py-0.5 rounded-md ${
      a.origen === 'GASTO' ? 'badge-gasto' :
      a.origen === 'C.A.' ? 'badge-ca' :
      a.origen === 'CENTRAL' ? 'badge-central' : 'badge-auditorio'
    }`;

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
                <div class="text-emerald-700 text-[11px] mt-0.5">Por: ${escapeHtml(h.asignado_por || 'Personal del Plantel')}</div>
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

      ${a.origen === 'CENTRAL' ? `
        <div class="border-t border-slate-100 pt-3">
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Datos de Oficina Central</h4>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg">
            <div><span class="text-slate-400 block">Familia:</span> ${a.familia || '-'}</div>
            <div><span class="text-slate-400 block">Factura:</span> ${a.numero_factura || '-'}</div>
            <div><span class="text-slate-400 block">Orden Compra:</span> ${a.orden_compra || '-'}</div>
            <div><span class="text-slate-400 block">Fecha Recepción:</span> ${a.fecha_recepcion || '-'}</div>
            <div><span class="text-slate-400 block">Costo:</span> ${a.costo ? `$${a.costo.toLocaleString()}` : '-'}</div>
            <div><span class="text-slate-400 block">Documento:</span> ${a.donacion_tipo || '-'}</div>
          </div>
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

// Modal de Asignación de Etiqueta Verde
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

// Guardar nueva etiqueta verde
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
    if (!res.ok) {
      throw new Error(data.detail || 'No fue posible asignar la etiqueta');
    }

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

// Toast de notificación
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

// Función auxiliar de escape HTML para prevenir XSS
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
