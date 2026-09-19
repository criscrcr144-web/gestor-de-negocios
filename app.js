/* Mi Inventario — lógica de la app (sin dependencias).
   Los datos se guardan en el navegador (localStorage). Todos los montos están en USD. */
(() => {
  'use strict';

  // ---------- Utilidades ----------
  const KEY = 'inventario.v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const money = n => usd.format(Number.isFinite(n) ? n : 0);
  const pct = n => (Number.isFinite(n) ? n.toFixed(1) + '%' : '—');
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const int = v => Math.max(0, Math.floor(num(v)));
  const round2 = n => Math.round(n * 100) / 100;
  const sum = (arr, fn) => arr.reduce((t, x) => t + fn(x), 0);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const DAY = 864e5;

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
  }

  // ---------- Datos ----------
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return { products: d.products || [], sales: d.sales || [] };
      }
    } catch (e) { /* datos dañados: se empieza en limpio */ }
    return { products: [], sales: [] };
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('No se pudo guardar en este navegador. Descarga un respaldo desde “Datos”.');
    }
  }

  const productById = id => state.products.find(p => p.id === id);
  // out = agotado, low = por agotarse (stock igual o menor al mínimo), ok = normal
  const statusOf = p => (p.stock <= 0 ? 'out' : p.stock <= p.min ? 'low' : 'ok');
  const STATUS_LABEL = { ok: 'En stock', low: 'Por agotarse', out: 'Agotado' };

  // ---------- Navegación ----------
  const VIEWS = ['inventario', 'ventas', 'reportes', 'calculadora'];

  function showView(name) {
    if (!VIEWS.includes(name)) name = 'inventario';
    VIEWS.forEach(v => { $('#view-' + v).hidden = v !== name; });
    $$('.tab').forEach(b => {
      const on = b.dataset.view === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignorar */ }
    if (name === 'reportes') renderReports();
  }

  // ---------- Alertas ----------
  function renderAlerts() {
    const box = $('#alerts');
    const out = state.products.filter(p => statusOf(p) === 'out');
    const low = state.products.filter(p => statusOf(p) === 'low');
    if (!out.length && !low.length) { box.hidden = true; box.innerHTML = ''; return; }

    const parts = [];
    if (out.length) parts.push(out.length + (out.length === 1 ? ' producto agotado' : ' productos agotados'));
    if (low.length) parts.push(low.length + (low.length === 1 ? ' por agotarse' : ' por agotarse'));
    const chip = p => `<button class="chip ${statusOf(p)}" data-action="restock" data-id="${p.id}">${esc(p.name)} <b>${p.stock}</b></button>`;

    box.hidden = false;
    box.innerHTML = `<div class="alerts-inner">
      <span class="alerts-title">Hay que reponer: ${parts.join(' y ')}</span>
      <div class="chips">${out.concat(low).map(chip).join('')}</div>
      <span class="alerts-note">Toca un producto para agregar stock.</span>
    </div>`;
  }

  // ---------- Inventario ----------
  function renderInventory() {
    const q = $('#search').value.trim().toLowerCase();
    const f = $('#filter').value;
    const order = { out: 0, low: 1, ok: 2 };

    const list = state.products
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
      .filter(p => f === 'all' || (f === 'low' && statusOf(p) !== 'ok') || (f === 'out' && statusOf(p) === 'out'))
      .sort((a, b) => order[statusOf(a)] - order[statusOf(b)] || a.name.localeCompare(b.name, 'es'));

    // Resumen
    $('#sum-products').textContent = state.products.length;
    const cost = sum(state.products, p => p.cost * p.stock);
    const retail = sum(state.products, p => p.price * p.stock);
    $('#sum-cost').textContent = money(cost);
    $('#sum-retail').textContent = money(retail);
    $('#sum-profit').textContent = money(retail - cost);

    // Categorías para autocompletar
    const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
    $('#cat-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');

    // Tabla
    const empty = $('#inv-empty');
    if (!list.length) {
      empty.hidden = false;
      empty.innerHTML = state.products.length
        ? 'Ningún producto coincide con la búsqueda.'
        : `Aún no tienes productos. Agrega el primero o carga datos de ejemplo para probar la app.
           <div class="actions">
             <button class="btn primary" data-action="new-product">Agregar producto</button>
             <button class="btn" data-action="seed">Cargar datos de ejemplo</button>
           </div>`;
    } else {
      empty.hidden = true;
      empty.innerHTML = '';
    }

    $('#inv-body').innerHTML = list.map(p => {
      const st = statusOf(p);
      const unit = p.price - p.cost;
      const margin = p.price > 0 ? (unit / p.price) * 100 : NaN;
      return `<tr>
        <td><strong>${esc(p.name)}</strong><div class="sub">${esc(p.category || 'Sin categoría')} · alerta con ${p.min} o menos</div></td>
        <td class="num"><span class="stock-n">${p.stock}</span><span class="pill ${st}">${STATUS_LABEL[st]}</span></td>
        <td class="num">${money(p.cost)}</td>
        <td class="num">${money(p.price)}</td>
        <td class="num"><span class="${unit < 0 ? 'neg' : 'pos'}">${money(unit)}</span><div class="sub">${pct(margin)} de margen</div></td>
        <td><div class="actions">
          <button class="btn sm primary" data-action="sell" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>Vender</button>
          <button class="btn sm" data-action="restock" data-id="${p.id}">Reponer</button>
          <button class="btn sm" data-action="edit" data-id="${p.id}">Editar</button>
          <button class="btn sm link-danger" data-action="delete" data-id="${p.id}">Eliminar</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  // ---------- Diálogo de producto ----------
  function openProduct(id, preset) {
    $('#product-form').reset();
    const p = id ? productById(id) : null;
    const v = p || preset || {};
    $('#product-title').textContent = p ? 'Editar producto' : 'Nuevo producto';
    $('#p-id').value = p ? p.id : '';
    $('#p-name').value = v.name || '';
    $('#p-category').value = v.category || '';
    $('#p-cost').value = v.cost != null ? Number(v.cost).toFixed(2) : '';
    $('#p-price').value = v.price != null ? Number(v.price).toFixed(2) : '';
    $('#p-stock').value = v.stock != null ? v.stock : '';
    $('#p-min').value = v.min != null ? v.min : 5;
    syncProductHint();
    $('#product-dialog').showModal();
    $('#p-name').focus();
  }

  function syncProductHint() {
    const cost = num($('#p-cost').value), price = num($('#p-price').value);
    const hint = $('#product-hint');
    if (!price) { hint.textContent = ''; return; }
    const unit = price - cost;
    hint.textContent = `Ganancia por unidad: ${money(unit)} (${pct(price > 0 ? unit / price * 100 : NaN)} de margen)` +
      (unit < 0 ? '. Estás vendiendo por debajo del costo.' : '');
  }

  function saveProduct(e) {
    e.preventDefault();
    const data = {
      name: $('#p-name').value.trim(),
      category: $('#p-category').value.trim(),
      cost: round2(num($('#p-cost').value)),
      price: round2(num($('#p-price').value)),
      stock: int($('#p-stock').value),
      min: int($('#p-min').value)
    };
    if (!data.name) { toast('Escribe el nombre del producto'); return; }
    const id = $('#p-id').value;
    if (id && productById(id)) {
      Object.assign(productById(id), data);
    } else {
      state.products.push({ id: uid(), ...data });
    }
    save();
    renderAll();
    $('#product-dialog').close();
    toast('Producto guardado');
  }

  function deleteProduct(id) {
    const p = productById(id);
    if (!p) return;
    if (!confirm(`¿Eliminar “${p.name}”? El historial de ventas se conserva.`)) return;
    state.products = state.products.filter(x => x.id !== id);
    save();
    renderAll();
    toast('Producto eliminado');
  }

  // ---------- Reponer stock ----------
  function openStock(id) {
    const p = productById(id);
    if (!p) return;
    $('#stock-form').reset();
    $('#r-id').value = p.id;
    $('#r-product').textContent = `${p.name} · stock actual: ${p.stock}`;
    $('#stock-dialog').showModal();
    $('#r-qty').focus();
  }

  function saveStock(e) {
    e.preventDefault();
    const p = productById($('#r-id').value);
    const qty = int($('#r-qty').value);
    if (!p || qty < 1) { toast('Escribe cuántas unidades llegan'); return; }
    p.stock += qty;
    const newCost = $('#r-cost').value;
    if (newCost !== '' && num(newCost) >= 0) p.cost = round2(num(newCost));
    save();
    renderAll();
    $('#stock-dialog').close();
    toast(`${p.name}: ahora hay ${p.stock} en stock`);
  }

  // ---------- Ventas ----------
  function openSale(id) {
    const avail = state.products.filter(p => p.stock > 0);
    if (!avail.length) { toast('No hay productos con stock para vender'); return; }
    $('#s-product').innerHTML = avail
      .map(p => `<option value="${p.id}">${esc(p.name)} (${p.stock} en stock)</option>`).join('');
    if (id && avail.some(p => p.id === id)) $('#s-product').value = id;
    syncSaleForm(true);
    $('#sale-dialog').showModal();
    $('#s-qty').focus();
  }

  function syncSaleForm(reset) {
    const p = productById($('#s-product').value);
    if (!p) return;
    $('#s-qty').max = p.stock;
    if (reset) {
      $('#s-qty').value = 1;
      $('#s-price').value = p.price.toFixed(2);
    }
    const qty = num($('#s-qty').value), price = num($('#s-price').value);
    $('#sale-hint').textContent = `Total: ${money(qty * price)} · Ganancia: ${money(qty * (price - p.cost))}`;
  }

  function saveSale(e) {
    e.preventDefault();
    const p = productById($('#s-product').value);
    const qty = int($('#s-qty').value);
    const price = round2(num($('#s-price').value));
    if (!p) return;
    if (qty < 1 || qty > p.stock) { toast(`Solo quedan ${p.stock} unidades en stock`); return; }
    state.sales.push({ id: uid(), productId: p.id, name: p.name, qty, price, cost: p.cost, date: Date.now() });
    p.stock -= qty;
    save();
    renderAll();
    $('#sale-dialog').close();
    const st = statusOf(p);
    toast(st === 'ok' ? 'Venta registrada'
      : `Venta registrada. ${p.name}: ${st === 'out' ? 'se agotó' : 'quedan ' + p.stock}, conviene reponer`);
  }

  function deleteSale(id) {
    const s = state.sales.find(x => x.id === id);
    if (!s) return;
    if (!confirm('¿Anular esta venta? Las unidades vuelven al stock.')) return;
    const p = productById(s.productId);
    if (p) p.stock += s.qty;
    state.sales = state.sales.filter(x => x.id !== id);
    save();
    renderAll();
    toast('Venta anulada');
  }

  function renderSales() {
    const list = [...state.sales].sort((a, b) => b.date - a.date).slice(0, 100);
    $('#sales-empty').hidden = list.length > 0;
    $('#sales-body').innerHTML = list.map(s => {
      const profit = s.qty * (s.price - s.cost);
      const when = new Date(s.date).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
      return `<tr>
        <td>${when}</td>
        <td>${esc((productById(s.productId) || {}).name || s.name)}</td>
        <td class="num">${s.qty}</td>
        <td class="num">${money(s.price)}</td>
        <td class="num">${money(s.qty * s.price)}</td>
        <td class="num ${profit < 0 ? 'neg' : 'pos'}">${money(profit)}</td>
        <td><div class="actions"><button class="btn sm link-danger" data-action="undo-sale" data-id="${s.id}">Anular</button></div></td>
      </tr>`;
    }).join('');
  }

  // ---------- Reportes ----------
  function renderReports() {
    const range = $('#r-range').value;
    const sortBy = $('#r-sort').value;
    const since = range === 'all' ? 0 : Date.now() - Number(range) * DAY;
    const sales = state.sales.filter(s => s.date >= since);

    const revenue = sum(sales, s => s.qty * s.price);
    const profit = sum(sales, s => s.qty * (s.price - s.cost));
    $('#r-units').textContent = sum(sales, s => s.qty);
    $('#r-revenue').textContent = money(revenue);
    $('#r-profit').textContent = money(profit);
    $('#r-margin').textContent = revenue > 0 ? pct(profit / revenue * 100) : '—';

    const groups = new Map();
    for (const s of sales) {
      const key = s.productId || s.name;
      const g = groups.get(key) || { name: s.name, units: 0, revenue: 0, profit: 0 };
      g.name = (productById(s.productId) || {}).name || s.name;
      g.units += s.qty;
      g.revenue += s.qty * s.price;
      g.profit += s.qty * (s.price - s.cost);
      groups.set(key, g);
    }

    const rows = [...groups.values()].sort((a, b) => b[sortBy] - a[sortBy]).slice(0, 10);
    const max = rows.length ? Math.max(rows[0][sortBy], 0) : 0;
    const fmt = v => (sortBy === 'units' ? v + ' u.' : money(v));

    $('#r-top').innerHTML = rows.length
      ? rows.map(r => `<div class="bar-row">
          <span class="bar-name" title="${esc(r.name)}">${esc(r.name)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${max > 0 ? Math.max(2, Math.max(r[sortBy], 0) / max * 100) : 0}%"></div></div>
          <span class="bar-val">${fmt(r[sortBy])}</span>
        </div>`).join('')
      : '<p class="muted">No hay ventas en este período.</p>';

    const unsold = state.products.filter(p => !groups.has(p.id));
    $('#r-unsold').innerHTML = unsold.length
      ? unsold.map(p => `<span>${esc(p.name)} · ${p.stock} en stock</span>`).join('')
      : '<p class="muted">Todos tus productos tuvieron ventas.</p>';
  }

  // ---------- Calculadora ----------
  let lastCalc = null;

  function calc() {
    const cost = num($('#c-cost').value);
    const qty = Math.max(1, Math.floor(num($('#c-qty').value)) || 1);
    const extra = num($('#c-extra').value);
    const mode = $('#c-mode').value;

    $('#c-target-field').hidden = mode === 'price';
    $('#c-price-field').hidden = mode !== 'price';
    $('#c-target-label').textContent = mode === 'markup'
      ? 'Recargo deseado sobre el costo (%)'
      : 'Margen deseado sobre el precio (%)';

    const invest = cost * qty + extra;
    const unit = invest / qty;
    let price = 0, error = '';

    if (mode === 'margin') {
      const m = num($('#c-target').value);
      if (m >= 100) error = 'El margen debe ser menor a 100%.';
      else price = unit / (1 - m / 100);
    } else if (mode === 'markup') {
      price = unit * (1 + num($('#c-target').value) / 100);
    } else {
      price = num($('#c-price').value);
    }

    price = round2(price);
    const unitProfit = price - unit;
    const revenue = price * qty;
    const profit = revenue - invest;
    const ready = unit > 0 && !error;

    $('#out-caption').textContent = mode === 'price' ? 'Tu precio de venta por unidad' : 'Precio de venta sugerido por unidad';
    $('#out-price').textContent = ready ? money(price) : '$0.00';
    $('#out-unit').textContent = ready ? money(unit) : '—';
    $('#out-unit-profit').textContent = ready ? money(unitProfit) : '—';
    $('#out-margin').textContent = ready && price > 0 ? pct(unitProfit / price * 100) : '—';
    $('#out-markup').textContent = ready ? pct(unitProfit / unit * 100) : '—';
    $('#out-invest').textContent = ready ? money(invest) : '—';
    $('#out-revenue').textContent = ready ? money(revenue) : '—';
    $('#out-profit').textContent = ready ? money(profit) : '—';

    const warn = $('#calc-warning');
    if (error) { warn.hidden = false; warn.textContent = error; }
    else if (ready && unitProfit < 0) { warn.hidden = false; warn.textContent = 'Con este precio pierdes dinero en cada unidad.'; }
    else { warn.hidden = true; }

    $('#out-profit').className = ready && profit < 0 ? 'neg' : '';
    $('#btn-calc-add').disabled = !ready || price <= 0;
    lastCalc = ready ? { cost: round2(unit), price, stock: qty } : null;
  }

  // ---------- Respaldo y exportación ----------
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCSV() {
    const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
    const head = ['Producto', 'Categoría', 'Costo USD', 'Precio USD', 'Stock', 'Alerta con'];
    const rows = state.products.map(p => [p.name, p.category || '', p.cost, p.price, p.stock, p.min].map(cell).join(','));
    download('inventario.csv', '\ufeff' + [head.map(cell).join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
  }

  function exportJSON() {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`respaldo-inventario-${stamp}.json`, JSON.stringify(state, null, 2), 'application/json');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!Array.isArray(d.products) || !Array.isArray(d.sales)) throw new Error('formato');
        if (!confirm('Esto reemplaza los datos actuales con los del respaldo. ¿Continuar?')) return;
        state = {
          products: d.products.map(p => ({
            id: String(p.id || uid()),
            name: String(p.name || 'Sin nombre').slice(0, 80),
            category: String(p.category || '').slice(0, 40),
            cost: Math.max(0, num(p.cost)), price: Math.max(0, num(p.price)),
            stock: int(p.stock), min: int(p.min)
          })),
          sales: d.sales.map(s => ({
            id: String(s.id || uid()), productId: String(s.productId || ''),
            name: String(s.name || '').slice(0, 80),
            qty: Math.max(1, int(s.qty)), price: Math.max(0, num(s.price)),
            cost: Math.max(0, num(s.cost)), date: num(s.date) || Date.now()
          }))
        };
        save();
        renderAll();
        toast('Respaldo restaurado');
      } catch (err) {
        toast('El archivo no es un respaldo válido');
      }
    };
    reader.readAsText(file);
  }

  // ---------- Datos de ejemplo ----------
  function seed() {
    const base = [
      ['Refresco 600 ml', 'Bebidas', 0.45, 0.80, 48, 12],
      ['Agua 1 L', 'Bebidas', 0.30, 0.60, 6, 15],
      ['Pan de caja', 'Panadería', 1.20, 2.00, 14, 6],
      ['Leche entera 1 L', 'Lácteos', 0.85, 1.30, 0, 10],
      ['Arroz 1 kg', 'Abarrotes', 0.70, 1.10, 32, 10],
      ['Aceite 900 ml', 'Abarrotes', 2.10, 3.10, 9, 8],
      ['Galletas surtidas', 'Snacks', 0.40, 0.75, 4, 10],
      ['Jabón de barra', 'Limpieza', 0.55, 0.95, 25, 8]
    ];
    const products = base.map(([name, category, cost, price, stock, min]) => ({ id: uid(), name, category, cost, price, stock, min }));
    const pattern = [0, 0, 1, 4, 0, 2, 5, 0, 7, 1, 3, 0, 4, 6, 2, 0, 1, 5, 7, 0, 3, 0, 1, 4, 2, 0, 5, 0, 7, 1];
    const sales = pattern.map((pi, i) => {
      const p = products[pi];
      return { id: uid(), productId: p.id, name: p.name, qty: 1 + (i % 4), price: p.price, cost: p.cost, date: Date.now() - (i % 24) * DAY - i * 36e5 };
    });
    state.products = state.products.concat(products);
    state.sales = state.sales.concat(sales);
    save();
    renderAll();
    toast('Datos de ejemplo cargados');
  }

  // ---------- Render general ----------
  function renderAll() {
    renderAlerts();
    renderInventory();
    renderSales();
    renderReports();
  }

  // ---------- Eventos ----------
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) { showView(tab.dataset.view); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const id = el.dataset.id;
    const menu = $('.menu');
    if (menu) menu.open = false;

    switch (el.dataset.action) {
      case 'new-product': openProduct(); break;
      case 'edit': openProduct(id); break;
      case 'delete': deleteProduct(id); break;
      case 'sell': openSale(id); break;
      case 'new-sale': openSale(); break;
      case 'restock': openStock(id); break;
      case 'undo-sale': deleteSale(id); break;
      case 'seed': seed(); break;
      case 'export-csv': exportCSV(); break;
      case 'export-json': exportJSON(); break;
      case 'import-json': $('#import-file').click(); break;
      case 'close-dialog': el.closest('dialog').close(); break;
    }
  });

  // Cerrar diálogos al hacer clic fuera
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  $('#search').addEventListener('input', renderInventory);
  $('#filter').addEventListener('change', renderInventory);
  $('#r-range').addEventListener('change', renderReports);
  $('#r-sort').addEventListener('change', renderReports);

  $('#product-form').addEventListener('submit', saveProduct);
  $('#product-form').addEventListener('input', syncProductHint);
  $('#stock-form').addEventListener('submit', saveStock);
  $('#sale-form').addEventListener('submit', saveSale);
  $('#s-product').addEventListener('change', () => syncSaleForm(true));
  $('#s-qty').addEventListener('input', () => syncSaleForm(false));
  $('#s-price').addEventListener('input', () => syncSaleForm(false));

  $('#import-file').addEventListener('change', e => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });

  $('#calc-form').addEventListener('input', calc);
  $('#calc-form').addEventListener('submit', e => e.preventDefault());
  $('#btn-calc-add').addEventListener('click', () => {
    if (!lastCalc) return;
    openProduct(null, { cost: lastCalc.cost, price: lastCalc.price, stock: lastCalc.stock });
  });

  // ---------- Inicio ----------
  renderAll();
  calc();
  showView(location.hash.replace('#', '') || 'inventario');
})();
