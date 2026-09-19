'use strict';
/* Mi Inventario — servidor (sin dependencias externas, requiere Node 18 o superior).
   Guarda cuentas, pagos y capturas en la carpeta ./data y sirve la carpeta ./public. */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

// ---------- Configuración ----------
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'capturas');
const INV_DIR = path.join(DATA_DIR, 'inventarios');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const DAY = 864e5;
const SESSION_MS = 30 * DAY;
const SUB_MS = 30 * DAY;             // cada pago aprobado suma 30 días
const MAX_SMALL = 64 * 1024;         // cuerpo normal
const MAX_PAYMENT = 6 * 1024 * 1024; // pago con captura
const MAX_DATA = 10 * 1024 * 1024;   // inventario completo
const MAX_IMAGE = 4 * 1024 * 1024;
const METHODS = ['pago_movil', 'tarjeta', 'binance'];

for (const d of [DATA_DIR, UPLOAD_DIR, INV_DIR]) fs.mkdirSync(d, { recursive: true });

let SECRET;
try {
  SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} catch (e) {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}

// ---------- Base de datos (archivo JSON) ----------
const defaultSettings = () => ({
  price: 2.99,
  rate: 0, // bolívares por dólar (opcional, para mostrar el monto del pago móvil)
  pagoMovil: { bank: '', phone: '', id: '', holder: '' },
  cardLink: '',
  binance: { id: '', network: '', note: '' }
});

let db = { users: [], payments: [], settings: defaultSettings() };
try {
  const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db = { users: d.users || [], payments: d.payments || [], settings: { ...defaultSettings(), ...(d.settings || {}) } };
} catch (e) { /* primera ejecución */ }

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- Utilidades ----------
const now = () => Date.now();
const newId = () => crypto.randomBytes(9).toString('base64url');
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const nn = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const ni = v => Math.max(0, Math.floor(nn(v)));
const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });
const validId = s => typeof s === 'string' && /^[\w-]{1,40}$/.test(s);

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = MAX_SMALL) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, tooBig = false;
    req.on('data', c => {
      if (tooBig) return;
      size += c.length;
      if (size > limit) { tooBig = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(httpError(413, 'El archivo o los datos son demasiado grandes'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(httpError(400, 'Solicitud inválida')); }
    });
    req.on('error', reject);
  });
}

// ---------- Contraseñas y sesiones ----------
async function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const buf = await scrypt(pw, salt, 64);
  return { salt, hash: buf.toString('hex') };
}
async function verifyPassword(pw, user) {
  const buf = await scrypt(pw, user.salt, 64);
  const stored = Buffer.from(user.hash, 'hex');
  return buf.length === stored.length && crypto.timingSafeEqual(buf, stored);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > now() ? p : null;
  } catch (e) { return null; }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function setSession(req, res, uid) {
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `sid=${sign({ uid, exp: now() + SESSION_MS })}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
}
const clearSession = res => res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');

function currentUser(req) {
  const p = verifyToken(parseCookies(req).sid);
  return p ? db.users.find(u => u.id === p.uid) || null : null;
}
function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw httpError(401, 'Inicia sesión para continuar');
  return u;
}
function requireAdmin(req) {
  const u = requireUser(req);
  if (u.role !== 'admin') throw httpError(403, 'Solo el administrador puede hacer esto');
  return u;
}

// Estado de acceso: active | unpaid | expired | blocked
function accessOf(u) {
  if (u.role === 'admin') return 'active';
  if (u.blocked) return 'blocked';
  if ((u.subscriptionEnd || 0) > now()) return 'active';
  return u.subscriptionEnd ? 'expired' : 'unpaid';
}
function requireActive(req) {
  const u = requireUser(req);
  const a = accessOf(u);
  if (a === 'blocked') throw httpError(403, 'Tu cuenta está bloqueada. Contacta al administrador.', 'blocked');
  if (a !== 'active') throw httpError(402, 'Necesitas una suscripción activa para usar la app', 'subscription');
  return u;
}
const publicUser = u => ({
  id: u.id, name: u.name, email: u.email, role: u.role, access: accessOf(u),
  blocked: !!u.blocked, subscriptionEnd: u.subscriptionEnd || 0, createdAt: u.createdAt
});

// Límite de intentos en memoria
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = now(), h = hits.get(key);
  if (!h || h.reset < t) { hits.set(key, { n: 1, reset: t + windowMs }); return; }
  if (++h.n > max) throw httpError(429, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
}
setInterval(() => { const t = now(); for (const [k, h] of hits) if (h.reset < t) hits.delete(k); }, 60000).unref();

function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || 'unknown';
}

// Protección contra peticiones de otros sitios (además de la cookie SameSite=Strict)
function csrfCheck(req) {
  if (req.headers['x-requested-with'] !== 'fetch') throw httpError(403, 'Solicitud no permitida');
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { /* inválido */ }
    if (host !== req.headers.host) throw httpError(403, 'Solicitud no permitida');
  }
}

// ---------- Inventario por usuario ----------
const invFile = id => path.join(INV_DIR, id + '.json');

function readInventory(id) {
  try { return JSON.parse(fs.readFileSync(invFile(id), 'utf8')); }
  catch (e) { return { products: [], sales: [] }; }
}
function writeInventory(id, inv) {
  const tmp = invFile(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(inv));
  fs.renameSync(tmp, invFile(id));
}
function cleanInventory(d) {
  if (!d || !Array.isArray(d.products) || !Array.isArray(d.sales)) throw httpError(400, 'Datos inválidos');
  if (d.products.length > 5000 || d.sales.length > 100000) throw httpError(413, 'Hay demasiados datos');
  return {
    products: d.products.map(p => ({
      id: str(p.id, 40) || newId(), name: str(p.name, 80) || 'Sin nombre', category: str(p.category, 40),
      cost: Math.max(0, nn(p.cost)), price: Math.max(0, nn(p.price)), stock: ni(p.stock), min: ni(p.min)
    })),
    sales: d.sales.map(s => ({
      id: str(s.id, 40) || newId(), productId: str(s.productId, 40), name: str(s.name, 80),
      qty: Math.max(1, ni(s.qty)), price: Math.max(0, nn(s.price)), cost: Math.max(0, nn(s.cost)), date: nn(s.date) || now()
    }))
  };
}

// ---------- Capturas de pago ----------
function parseImage(dataUrl) {
  const s = String(dataUrl || '');
  const m = /^data:image\/(?:png|jpeg|webp);base64,/.exec(s.slice(0, 40));
  if (!m) throw httpError(400, 'La captura debe ser una imagen PNG, JPG o WEBP');
  const buf = Buffer.from(s.slice(m[0].length), 'base64');
  if (buf.length < 100) throw httpError(400, 'La imagen está vacía o dañada');
  if (buf.length > MAX_IMAGE) throw httpError(413, 'La imagen pesa más de 4 MB');
  const isPng = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  const ext = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : null;
  if (!ext) throw httpError(400, 'El archivo no es una imagen válida');
  return { buf, ext };
}
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const publicPayment = p => ({
  id: p.id, method: p.method, reference: p.reference, amount: p.amount, status: p.status,
  note: p.note || '', createdAt: p.createdAt, reviewedAt: p.reviewedAt || null
});

// ---------- Ajustes que edita el super admin ----------
function cleanSettings(b) {
  let card = str(b.cardLink, 500);
  if (card) {
    let u;
    try { u = new URL(card); } catch (e) { throw httpError(400, 'El enlace de pago con tarjeta no es válido'); }
    if (u.protocol !== 'https:') throw httpError(400, 'El enlace de pago con tarjeta debe empezar con https://');
    card = u.href;
  }
  const price = nn(b.price);
  if (!(price >= 0.5 && price <= 1000)) throw httpError(400, 'El precio mensual debe estar entre 0.50 y 1000 USD');
  const rate = nn(b.rate);
  if (rate < 0 || rate > 1e7) throw httpError(400, 'La tasa en bolívares no es válida');
  const pm = b.pagoMovil || {}, bn = b.binance || {};
  return {
    price: Math.round(price * 100) / 100,
    rate,
    pagoMovil: { bank: str(pm.bank, 80), phone: str(pm.phone, 40), id: str(pm.id, 40), holder: str(pm.holder, 80) },
    cardLink: card,
    binance: { id: str(bn.id, 120), network: str(bn.network, 60), note: str(bn.note, 300) }
  };
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD') csrfCheck(req);
  let m;

  // --- Público ---
  if (method === 'GET' && pathname === '/api/public') {
    return send(res, 200, { price: db.settings.price });
  }

  if (method === 'POST' && pathname === '/api/register') {
    rateLimit('reg:' + clientIp(req), 10, 3600e3);
    const b = await readBody(req);
    const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), pw = String(b.password || '');
    if (name.length < 2) throw httpError(400, 'Escribe tu nombre');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'El correo no es válido');
    if (pw.length < 8 || pw.length > 200) throw httpError(400, 'La contraseña debe tener al menos 8 caracteres');
    if (db.users.some(u => u.email === email)) throw httpError(409, 'Ya existe una cuenta con ese correo');
    const { salt, hash } = await hashPassword(pw);
    if (db.users.some(u => u.email === email)) throw httpError(409, 'Ya existe una cuenta con ese correo');
    const user = { id: newId(), name, email, role: 'user', salt, hash, blocked: false, subscriptionEnd: 0, createdAt: now() };
    db.users.push(user);
    saveDb();
    setSession(req, res, user.id);
    return send(res, 201, { user: publicUser(user) });
  }

  if (method === 'POST' && pathname === '/api/login') {
    rateLimit('login:ip:' + clientIp(req), 30, 900e3);
    const b = await readBody(req);
    const email = str(b.email, 120).toLowerCase();
    rateLimit('login:mail:' + email, 10, 900e3);
    const user = db.users.find(u => u.email === email);
    let ok = false;
    if (user) ok = await verifyPassword(String(b.password || ''), user);
    else await hashPassword('igualar-tiempos');
    if (!ok) throw httpError(401, 'Correo o contraseña incorrectos');
    setSession(req, res, user.id);
    return send(res, 200, { user: publicUser(user) });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    clearSession(res);
    return send(res, 200, { ok: true });
  }

  // --- Cuenta del usuario ---
  if (method === 'GET' && pathname === '/api/me') {
    const u = requireUser(req);
    return send(res, 200, { user: publicUser(u), price: db.settings.price });
  }

  if (method === 'GET' && pathname === '/api/payment-info') {
    requireUser(req);
    const s = db.settings;
    return send(res, 200, { price: s.price, rate: s.rate, pagoMovil: s.pagoMovil, cardLink: s.cardLink, binance: s.binance });
  }

  if (method === 'GET' && pathname === '/api/payments/mine') {
    const u = requireUser(req);
    const list = db.payments.filter(p => p.userId === u.id).sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, { payments: list.map(publicPayment) });
  }

  if (method === 'POST' && pathname === '/api/payments') {
    const u = requireUser(req);
    if (u.role === 'admin') throw httpError(400, 'La cuenta de administrador no necesita suscripción');
    if (u.blocked) throw httpError(403, 'Tu cuenta está bloqueada. Contacta al administrador.', 'blocked');
    rateLimit('pay:' + u.id, 10, 3600e3);
    const b = await readBody(req, MAX_PAYMENT);
    const methodKey = String(b.method || '');
    if (!METHODS.includes(methodKey)) throw httpError(400, 'Elige un método de pago');
    const reference = str(b.reference, 64);
    if (!/^[\w.\-\s]{4,64}$/.test(reference)) throw httpError(400, 'Escribe el número de referencia del pago (mínimo 4 caracteres)');
    if (db.payments.some(p => p.userId === u.id && p.status === 'pending')) {
      throw httpError(409, 'Ya tienes un comprobante en revisión. Espera la respuesta antes de enviar otro.');
    }
    // Se compara sin espacios, guiones ni mayúsculas para que no se pueda reutilizar una referencia cambiando el formato
    const normRef = r => r.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dup = db.payments.some(p => p.method === methodKey && p.status !== 'rejected' && normRef(p.reference) === normRef(reference));
    if (dup) throw httpError(409, 'Ese número de referencia ya fue usado en otro pago');
    const { buf, ext } = parseImage(b.image);
    const id = newId();
    const image = `${id}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, image), buf, { mode: 0o600 });
    const payment = {
      id, userId: u.id, method: methodKey, reference, amount: db.settings.price,
      image, status: 'pending', note: '', createdAt: now(), reviewedAt: null
    };
    db.payments.push(payment);
    saveDb();
    return send(res, 201, { payment: publicPayment(payment) });
  }

  if (method === 'GET' && (m = /^\/api\/payments\/([\w-]+)\/image$/.exec(pathname))) {
    const u = requireUser(req);
    const p = db.payments.find(x => x.id === m[1]);
    if (!p || (u.role !== 'admin' && p.userId !== u.id)) throw httpError(404, 'No encontrado');
    let buf;
    try { buf = fs.readFileSync(path.join(UPLOAD_DIR, p.image)); }
    catch (e) { throw httpError(404, 'La captura ya no está disponible'); }
    res.writeHead(200, {
      'Content-Type': IMG_MIME[path.extname(p.image).slice(1)] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "default-src 'none'"
    });
    return res.end(buf);
  }

  // --- Inventario (solo con suscripción activa) ---
  if (method === 'GET' && pathname === '/api/data') {
    const u = requireActive(req);
    return send(res, 200, readInventory(u.id));
  }
  if (method === 'PUT' && pathname === '/api/data') {
    const u = requireActive(req);
    const inv = cleanInventory(await readBody(req, MAX_DATA));
    writeInventory(u.id, inv);
    return send(res, 200, { ok: true });
  }

  // --- Super admin ---
  if (pathname.startsWith('/api/admin/')) {
    const admin = requireAdmin(req);

    if (method === 'GET' && pathname === '/api/admin/users') {
      const users = db.users.filter(u => u.role !== 'admin');
      const list = users.map(u => ({
        ...publicUser(u),
        pendingPayments: db.payments.filter(p => p.userId === u.id && p.status === 'pending').length
      })).sort((a, b) => b.createdAt - a.createdAt);
      const stats = {
        total: users.length,
        active: list.filter(u => u.access === 'active').length,
        toPay: list.filter(u => u.access === 'unpaid' || u.access === 'expired').length,
        blocked: list.filter(u => u.access === 'blocked').length,
        pendingPayments: db.payments.filter(p => p.status === 'pending').length,
        revenue: Math.round(db.payments.filter(p => p.status === 'approved').reduce((t, p) => t + p.amount, 0) * 100) / 100
      };
      return send(res, 200, { users: list, stats });
    }

    if (method === 'GET' && pathname === '/api/admin/payments') {
      const onlyPending = url.searchParams.get('status') !== 'all';
      const list = db.payments
        .filter(p => !onlyPending || p.status === 'pending')
        .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.createdAt - a.createdAt)
        .slice(0, 300)
        .map(p => {
          const u = db.users.find(x => x.id === p.userId);
          return { ...publicPayment(p), user: u ? { name: u.name, email: u.email } : { name: '(cuenta eliminada)', email: '' } };
        });
      return send(res, 200, { payments: list });
    }

    if (method === 'POST' && (m = /^\/api\/admin\/payments\/([\w-]+)\/(approve|reject)$/.exec(pathname))) {
      const p = db.payments.find(x => x.id === m[1]);
      if (!p) throw httpError(404, 'Pago no encontrado');
      if (p.status !== 'pending') throw httpError(409, 'Este pago ya fue revisado');
      const b = await readBody(req);
      const u = db.users.find(x => x.id === p.userId);
      if (m[2] === 'approve') {
        if (!u) throw httpError(409, 'La cuenta de este pago ya no existe');
        if (u.blocked) throw httpError(409, 'El suscriptor está bloqueado. Desbloquéalo antes de aceptar el pago.');
        p.status = 'approved';
        u.subscriptionEnd = Math.max(now(), u.subscriptionEnd || 0) + SUB_MS;
      } else {
        p.status = 'rejected';
        p.note = str(b.note, 200);
      }
      p.reviewedAt = now();
      p.reviewedBy = admin.id;
      saveDb();
      return send(res, 200, { payment: publicPayment(p), user: u ? publicUser(u) : null });
    }

    if (method === 'POST' && (m = /^\/api\/admin\/users\/([\w-]+)\/(block|unblock|extend)$/.exec(pathname))) {
      const u = db.users.find(x => x.id === m[1]);
      if (!u || u.role === 'admin') throw httpError(404, 'Suscriptor no encontrado');
      if (m[2] === 'block') u.blocked = true;
      else if (m[2] === 'unblock') u.blocked = false;
      else u.subscriptionEnd = Math.max(now(), u.subscriptionEnd || 0) + SUB_MS;
      saveDb();
      return send(res, 200, { user: publicUser(u) });
    }

    if (method === 'DELETE' && (m = /^\/api\/admin\/users\/([\w-]+)$/.exec(pathname))) {
      const u = db.users.find(x => x.id === m[1]);
      if (!u || u.role === 'admin') throw httpError(404, 'Suscriptor no encontrado');
      for (const p of db.payments.filter(x => x.userId === u.id)) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, p.image)); } catch (e) { /* ya no existe */ }
      }
      db.payments = db.payments.filter(p => p.userId !== u.id);
      db.users = db.users.filter(x => x.id !== u.id);
      try { fs.unlinkSync(invFile(u.id)); } catch (e) { /* sin inventario */ }
      saveDb();
      return send(res, 200, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/admin/settings') {
      return send(res, 200, { settings: db.settings });
    }
    if (method === 'PUT' && pathname === '/api/admin/settings') {
      db.settings = cleanSettings(await readBody(req));
      saveDb();
      return send(res, 200, { settings: db.settings });
    }

    if (method === 'POST' && pathname === '/api/admin/password') {
      const b = await readBody(req);
      const next = String(b.next || '');
      if (!(await verifyPassword(String(b.current || ''), admin))) throw httpError(400, 'La contraseña actual no es correcta');
      if (next.length < 10 || next.length > 200) throw httpError(400, 'La nueva contraseña debe tener al menos 10 caracteres');
      Object.assign(admin, await hashPassword(next));
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  throw httpError(404, 'No encontrado');
}

// ---------- Archivos estáticos ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  const notFound = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); };
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch (e) { return notFound(); }
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || rel.split('/').some(s => s.startsWith('.'))) return notFound();
  fs.readFile(file, (err, buf) => {
    if (err) return notFound();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

// ---------- Servidor ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Método no permitido');
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    if (!err.status) console.error(err);
    if (res.headersSent) return res.end();
    send(res, err.status || 500, { error: err.status ? err.message : 'Error interno del servidor', code: err.code });
  }
});

// ---------- Inicio: crea el super admin la primera vez ----------
(async () => {
  if (!db.users.some(u => u.role === 'admin')) {
    const email = str(process.env.ADMIN_EMAIL || 'admin@mi-inventario.local', 120).toLowerCase();
    let pw = process.env.ADMIN_PASSWORD;
    const generated = !pw;
    if (generated) pw = crypto.randomBytes(9).toString('base64url');
    const { salt, hash } = await hashPassword(pw);
    db.users.push({ id: newId(), name: 'Super admin', email, role: 'admin', salt, hash, blocked: false, subscriptionEnd: 0, createdAt: now() });
    saveDb();
    console.log('\n=== Super admin creado ===');
    console.log('Correo:     ' + email);
    console.log('Contraseña: ' + (generated ? pw + '   (generada; cámbiala desde el panel)' : '(la que definiste en ADMIN_PASSWORD)'));
    console.log('==========================\n');
  }
  server.listen(PORT, () => console.log(`Mi Inventario listo en http://localhost:${PORT}`));
})();
