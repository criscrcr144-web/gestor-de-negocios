/* Utilidades compartidas por todas las páginas */
window.Common = (() => {
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw Object.assign(new Error('No hay conexión con el servidor'), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) {
      throw Object.assign(new Error((data && data.error) || 'Ocurrió un error'), { status: res.status, code: data && data.code });
    }
    return data;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
  const fmtDate = ts => (ts ? new Date(ts).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const fmtDay = ts => (ts ? new Date(ts).toLocaleDateString('es', { dateStyle: 'medium' }) : '—');

  const METHOD_LABEL = { pago_movil: 'Pago móvil', tarjeta: 'Tarjeta de crédito', binance: 'Binance' };
  const PAY_STATUS = { pending: ['low', 'En revisión'], approved: ['ok', 'Aprobado'], rejected: ['out', 'Rechazado'] };

  let timer;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) { alert(msg); return; }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  async function logout() {
    try { await api('POST', '/api/logout'); } catch (e) { /* ignorar */ }
    location.href = 'index.html';
  }

  return { api, esc, money, fmtDate, fmtDay, toast, logout, METHOD_LABEL, PAY_STATUS };
})();
