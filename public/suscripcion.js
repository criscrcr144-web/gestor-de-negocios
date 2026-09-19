/* Página de suscripción: estado, datos de pago y envío de comprobante */
(() => {
  const { api, esc, money, fmtDate, fmtDay, toast, METHOD_LABEL, PAY_STATUS } = Common;
  const $ = s => document.querySelector(s);

  let me, info, payments = [];

  // ---------- Estado de la cuenta ----------
  function renderStatus() {
    const u = me.user;
    const pending = payments.find(p => p.status === 'pending');
    const lastRejected = payments.length && payments[0].status === 'rejected' ? payments[0] : null;
    let cls = 'warn', html = '';

    if (u.access === 'blocked') {
      cls = 'bad';
      html = '<strong>Tu cuenta está bloqueada.</strong> Contacta al administrador para resolverlo.';
    } else if (u.access === 'active') {
      cls = 'good';
      html = `<strong>Tu suscripción está activa hasta el ${fmtDay(u.subscriptionEnd)}.</strong> Puedes renovar cuando quieras: los días se suman.`;
    } else if (pending) {
      html = '<strong>Recibimos tu comprobante.</strong> Lo estamos revisando; cuando lo aprobemos podrás entrar a la app.';
    } else if (u.access === 'expired') {
      html = `<strong>Tu suscripción venció el ${fmtDay(u.subscriptionEnd)}.</strong> Renueva para seguir usando la app. Tus datos siguen guardados.`;
    } else {
      html = '<strong>Falta un paso.</strong> Paga tu primera suscripción para empezar a usar la app.';
    }
    if (lastRejected && u.access !== 'blocked') {
      html += `<br>Tu último comprobante fue rechazado${lastRejected.note ? ': ' + esc(lastRejected.note) : '.'} Puedes enviar uno nuevo.`;
    }
    $('#status').className = 'status ' + cls;
    $('#status').innerHTML = html;
    $('#go-app').hidden = u.access !== 'active';
  }

  // ---------- Datos de cada método ----------
  const row = (label, value) => value
    ? `<div><dt>${esc(label)}</dt><dd>${esc(value)} <button type="button" class="copy" data-copy="${esc(value)}">Copiar</button></dd></div>`
    : '';

  function renderMethod() {
    const method = document.querySelector('input[name="method"]:checked').value;
    const panel = $('#method-panel');
    const price = info.price;
    let html = '';

    if (method === 'pago_movil') {
      const p = info.pagoMovil;
      if (!p.bank && !p.phone && !p.id) {
        html = '<p class="muted">Este método todavía no está disponible. Elige otro.</p>';
      } else {
        const bs = info.rate > 0 ? ` (aprox. Bs. ${(price * info.rate).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a tasa ${info.rate})` : '';
        html = `<dl class="rows">
          ${row('Banco', p.bank)}${row('Teléfono', p.phone)}${row('Cédula o RIF', p.id)}${row('Titular', p.holder)}
          <div><dt>Monto</dt><dd>${money(price)}${esc(bs)}</dd></div>
        </dl>
        <p class="muted">Haz el pago móvil a estos datos y guarda la captura con el número de referencia visible.</p>`;
      }
    } else if (method === 'tarjeta') {
      if (!info.cardLink) {
        html = '<p class="muted">Este método todavía no está disponible. Elige otro.</p>';
      } else {
        html = `<p>Paga ${money(price)} con tu tarjeta de crédito en la página segura de pago.</p>
          <a class="btn primary" href="${esc(info.cardLink)}" target="_blank" rel="noopener noreferrer">Pagar con tarjeta</a>
          <p class="muted">Al terminar, vuelve aquí y sube la captura del pago con el número de referencia o de confirmación.</p>`;
      }
    } else {
      const b = info.binance;
      if (!b.id) {
        html = '<p class="muted">Este método todavía no está disponible. Elige otro.</p>';
      } else {
        html = `<dl class="rows">
          ${row('Binance Pay ID / correo', b.id)}${row('Red', b.network)}
          <div><dt>Monto</dt><dd>${money(price)}</dd></div>
        </dl>
        ${b.note ? `<p class="muted">${esc(b.note)}</p>` : ''}
        <p class="muted">Envía el pago, y sube la captura con el ID de la transacción como número de referencia.</p>`;
      }
    }
    panel.innerHTML = html;
  }

  // ---------- Historial ----------
  function renderHistory() {
    $('#history-section').hidden = !payments.length;
    $('#history-body').innerHTML = payments.map(p => {
      const [cls, label] = PAY_STATUS[p.status] || ['low', p.status];
      return `<tr>
        <td>${fmtDate(p.createdAt)}</td>
        <td>${esc(METHOD_LABEL[p.method] || p.method)}</td>
        <td>${esc(p.reference)}</td>
        <td class="num">${money(p.amount)}</td>
        <td><span class="pill ${cls}">${label}</span>${p.note ? `<div class="sub">${esc(p.note)}</div>` : ''}</td>
      </tr>`;
    }).join('');
  }

  // ---------- Formulario ----------
  function updateFormState() {
    const u = me.user;
    const pending = payments.some(p => p.status === 'pending');
    $('#pay-section').hidden = u.access === 'blocked';
    const form = $('#pay-form');
    const locked = pending;
    [...form.elements].forEach(el => { el.disabled = locked; });
    if (locked) {
      $('#pay-error').hidden = false;
      $('#pay-error').textContent = 'Ya tienes un comprobante en revisión. Cuando respondamos podrás enviar otro.';
    }
  }

  function prepareImage(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('Sube una imagen PNG, JPG o WEBP')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }

  $('#pay-file').addEventListener('change', e => {
    const f = e.target.files[0];
    const prev = $('#pay-preview');
    if (!f) { prev.hidden = true; return; }
    prev.src = URL.createObjectURL(f);
    prev.hidden = false;
  });

  $('#pay-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#pay-error');
    const btn = $('#pay-submit');
    err.hidden = true;
    const file = $('#pay-file').files[0];
    if (!file) { err.textContent = 'Adjunta la captura del pago'; err.hidden = false; return; }
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const image = await prepareImage(file);
      await api('POST', '/api/payments', {
        method: document.querySelector('input[name="method"]:checked').value,
        reference: $('#pay-ref').value.trim(),
        image
      });
      $('#pay-form').reset();
      $('#pay-preview').hidden = true;
      toast('Comprobante enviado. Lo revisaremos pronto.');
      await load();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.textContent = 'Enviar comprobante';
      updateFormState();
    }
  });

  document.querySelectorAll('input[name="method"]').forEach(r => r.addEventListener('change', renderMethod));

  document.addEventListener('click', async e => {
    const btn = e.target.closest('.copy');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      toast('Copiado');
    } catch (ex) {
      toast('No se pudo copiar. Selecciona el texto y cópialo.');
    }
  });

  $('#btn-logout').addEventListener('click', Common.logout);

  // ---------- Carga ----------
  async function load() {
    me = await api('GET', '/api/me');
    if (me.user.role === 'admin') { location.href = 'admin.html'; return; }
    [info, { payments }] = await Promise.all([api('GET', '/api/payment-info'), api('GET', '/api/payments/mine')]);
    $('#user-email').textContent = me.user.email;
    $('#pay-price').textContent = money(info.price);
    renderStatus();
    renderMethod();
    renderHistory();
    updateFormState();
    document.body.classList.add('ready');
  }

  load().catch(e => {
    if (e.status === 401) location.href = 'index.html';
    else toast(e.message);
  });
})();
