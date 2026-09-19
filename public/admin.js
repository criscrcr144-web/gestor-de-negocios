/* Panel de super admin */
(() => {
  const { api, esc, money, fmtDate, fmtDay, toast, METHOD_LABEL, PAY_STATUS } = Common;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  let users = [], payments = [];
  const VIEWS = ['pagos', 'suscriptores', 'config', 'cuenta'];

  // ---------- Navegación ----------
  function showView(name) {
    if (!VIEWS.includes(name)) name = 'pagos';
    VIEWS.forEach(v => { $('#view-' + v).hidden = v !== name; });
    $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignorar */ }
  }

  function fail(e) {
    if (e.status === 401 || e.status === 403) location.href = 'index.html';
    else toast(e.message);
  }

  // ---------- Pagos ----------
  async function loadPayments() {
    const status = $('#pay-filter').value;
    payments = (await api('GET', '/api/admin/payments?status=' + status)).payments;
    renderPayments();
  }

  function renderPayments() {
    $('#pay-empty').hidden = payments.length > 0;
    $('#pay-body').innerHTML = payments.map(p => {
      const [cls, label] = PAY_STATUS[p.status] || ['low', p.status];
      const review = p.status === 'pending'
        ? `<button class="btn sm primary" data-action="approve" data-id="${p.id}">Aceptar</button>
           <button class="btn sm link-danger" data-action="reject" data-id="${p.id}">Rechazar</button>`
        : '';
      return `<tr>
        <td>${fmtDate(p.createdAt)}</td>
        <td><strong>${esc(p.user.name)}</strong><div class="sub">${esc(p.user.email)}</div></td>
        <td>${esc(METHOD_LABEL[p.method] || p.method)}</td>
        <td>${esc(p.reference)}</td>
        <td class="num">${money(p.amount)}</td>
        <td><span class="pill ${cls}">${label}</span>${p.note ? `<div class="sub">${esc(p.note)}</div>` : ''}</td>
        <td><div class="actions">
          <button class="btn sm" data-action="view-img" data-id="${p.id}" data-title="${esc(p.user.name)} · ${esc(p.reference)}">Ver captura</button>
          ${review}
        </div></td>
      </tr>`;
    }).join('');
  }

  async function review(id, kind) {
    let body = {};
    if (kind === 'reject') {
      const note = prompt('Motivo del rechazo (el suscriptor lo verá). Puedes dejarlo vacío:');
      if (note === null) return;
      body = { note };
    } else if (!confirm('¿Aceptar este pago? Se activan 30 días para el suscriptor.')) {
      return;
    }
    try {
      await api('POST', `/api/admin/payments/${id}/${kind}`, body);
      toast(kind === 'approve' ? 'Pago aceptado. Suscripción activada por 30 días.' : 'Pago rechazado');
      await refresh();
    } catch (e) { fail(e); }
  }

  // ---------- Suscriptores ----------
  async function loadUsers() {
    const d = await api('GET', '/api/admin/users');
    users = d.users;
    $('#st-total').textContent = d.stats.total;
    $('#st-active').textContent = d.stats.active;
    $('#st-topay').textContent = d.stats.toPay;
    $('#st-blocked').textContent = d.stats.blocked;
    $('#st-revenue').textContent = money(d.stats.revenue);
    const badge = $('#badge-pending');
    badge.textContent = d.stats.pendingPayments;
    badge.hidden = d.stats.pendingPayments === 0;
    renderUsers();
  }

  function accessPill(u) {
    if (u.access === 'active') return `<span class="pill ok">Activo hasta ${fmtDay(u.subscriptionEnd)}</span>`;
    if (u.access === 'blocked') return '<span class="pill out">Bloqueado</span>';
    if (u.access === 'expired') return `<span class="pill low">Venció el ${fmtDay(u.subscriptionEnd)}</span>`;
    return '<span class="pill neutral">Sin pagar</span>';
  }

  function renderUsers() {
    const q = $('#user-search').value.trim().toLowerCase();
    const list = users.filter(u => !q || u.name.toLowerCase().includes(q) || u.email.includes(q));
    $('#user-empty').hidden = list.length > 0;
    $('#user-empty').textContent = users.length ? 'Ningún suscriptor coincide con la búsqueda.' : 'Todavía no hay suscriptores.';
    $('#user-body').innerHTML = list.map(u => `<tr>
      <td><strong>${esc(u.name)}</strong><div class="sub">${esc(u.email)}</div></td>
      <td>${accessPill(u)}${u.pendingPayments ? `<div class="sub"><a href="#pagos" data-action="go-pagos">${u.pendingPayments} pago por revisar</a></div>` : ''}</td>
      <td>${fmtDay(u.createdAt)}</td>
      <td><div class="actions">
        <button class="btn sm" data-action="extend" data-id="${u.id}">Activar +30 días</button>
        ${u.blocked
          ? `<button class="btn sm" data-action="unblock" data-id="${u.id}">Desbloquear</button>`
          : `<button class="btn sm" data-action="block" data-id="${u.id}">Bloquear</button>`}
        <button class="btn sm link-danger" data-action="delete" data-id="${u.id}">Eliminar</button>
      </div></td>
    </tr>`).join('');
  }

  async function userAction(id, kind) {
    const u = users.find(x => x.id === id);
    if (!u) return;
    try {
      if (kind === 'delete') {
        if (!confirm(`¿Eliminar a ${u.name} (${u.email})? Se borran su cuenta, su inventario, sus pagos y sus capturas. No se puede deshacer.`)) return;
        await api('DELETE', `/api/admin/users/${id}`);
        toast('Suscriptor eliminado');
      } else {
        if (kind === 'block' && !confirm(`¿Bloquear a ${u.name}? No podrá entrar a la app hasta que lo desbloquees.`)) return;
        if (kind === 'extend' && !confirm(`¿Activar 30 días para ${u.name} sin pago?`)) return;
        await api('POST', `/api/admin/users/${id}/${kind}`);
        toast({ block: 'Suscriptor bloqueado', unblock: 'Suscriptor desbloqueado', extend: 'Se sumaron 30 días' }[kind]);
      }
      await refresh();
    } catch (e) { fail(e); }
  }

  // ---------- Datos de pago ----------
  async function loadSettings() {
    const { settings: s } = await api('GET', '/api/admin/settings');
    $('#st-price').value = s.price;
    $('#st-rate').value = s.rate || '';
    $('#pm-bank').value = s.pagoMovil.bank;
    $('#pm-phone').value = s.pagoMovil.phone;
    $('#pm-id').value = s.pagoMovil.id;
    $('#pm-holder').value = s.pagoMovil.holder;
    $('#st-card').value = s.cardLink;
    $('#bn-id').value = s.binance.id;
    $('#bn-network').value = s.binance.network;
    $('#bn-note').value = s.binance.note;
  }

  $('#settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('PUT', '/api/admin/settings', {
        price: $('#st-price').value,
        rate: $('#st-rate').value || 0,
        pagoMovil: { bank: $('#pm-bank').value, phone: $('#pm-phone').value, id: $('#pm-id').value, holder: $('#pm-holder').value },
        cardLink: $('#st-card').value,
        binance: { id: $('#bn-id').value, network: $('#bn-network').value, note: $('#bn-note').value }
      });
      toast('Datos de pago guardados');
      await loadSettings();
    } catch (ex) { fail(ex); }
  });

  // ---------- Mi cuenta ----------
  $('#password-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('POST', '/api/admin/password', { current: $('#pw-current').value, next: $('#pw-next').value });
      e.target.reset();
      toast('Contraseña cambiada');
    } catch (ex) {
      if (ex.status === 401) location.href = 'index.html'; else toast(ex.message);
    }
  });

  // ---------- Eventos ----------
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) { showView(tab.dataset.view); return; }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'approve': review(id, 'approve'); break;
      case 'reject': review(id, 'reject'); break;
      case 'view-img':
        $('#img-title').textContent = el.dataset.title;
        $('#img-full').src = `/api/payments/${id}/image`;
        $('#img-dialog').showModal();
        break;
      case 'close-dialog': el.closest('dialog').close(); break;
      case 'go-pagos': e.preventDefault(); showView('pagos'); break;
      case 'block': case 'unblock': case 'extend': case 'delete': userAction(id, el.dataset.action); break;
    }
  });

  $('#img-dialog').addEventListener('click', e => { if (e.target === $('#img-dialog')) $('#img-dialog').close(); });
  $('#pay-filter').addEventListener('change', () => loadPayments().catch(fail));
  $('#user-search').addEventListener('input', renderUsers);
  $('#btn-logout').addEventListener('click', Common.logout);

  async function refresh() {
    await Promise.all([loadPayments(), loadUsers()]);
  }

  // ---------- Inicio ----------
  (async () => {
    try {
      const me = await api('GET', '/api/me');
      if (me.user.role !== 'admin') { location.href = 'app.html'; return; }
      await Promise.all([refresh(), loadSettings()]);
      showView(location.hash.replace('#', '') || 'pagos');
      document.body.classList.add('ready');
    } catch (e) { fail(e); }
  })();
})();
