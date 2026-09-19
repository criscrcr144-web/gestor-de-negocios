/* Inicio de sesión y registro */
(() => {
  const $ = s => document.querySelector(s);
  const errorBox = $('#auth-error');

  function goTo(user) {
    location.href = user.role === 'admin' ? 'admin.html'
      : user.access === 'active' ? 'app.html'
      : 'suscripcion.html';
  }

  function setMode(mode) {
    $('#login-form').hidden = mode !== 'login';
    $('#register-form').hidden = mode !== 'register';
    document.querySelectorAll('.switch button').forEach(b => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    errorBox.hidden = true;
  }

  document.querySelectorAll('.switch button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  async function submit(form, url, payload) {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    errorBox.hidden = true;
    try {
      const { user } = await Common.api('POST', url, payload);
      goTo(user);
    } catch (e) {
      errorBox.textContent = e.message;
      errorBox.hidden = false;
      btn.disabled = false;
    }
  }

  $('#login-form').addEventListener('submit', e => {
    e.preventDefault();
    submit(e.target, '/api/login', { email: $('#l-email').value, password: $('#l-password').value });
  });

  $('#register-form').addEventListener('submit', e => {
    e.preventDefault();
    submit(e.target, '/api/register', { name: $('#r-name').value, email: $('#r-email').value, password: $('#r-password').value });
  });

  // Si ya hay sesión iniciada, entra directo
  (async () => {
    try { goTo((await Common.api('GET', '/api/me')).user); } catch (e) { /* sin sesión */ }
    try { $('#pitch-price').textContent = Common.money((await Common.api('GET', '/api/public')).price); } catch (e) { /* usa el valor por defecto */ }
  })();
})();
