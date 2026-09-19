# Mi Inventario

Gestor de inventario para tiendas pequeñas con suscripción mensual (por defecto 2.99 USD) y panel de super admin.
No usa librerías externas: solo necesita **Node 18 o superior**.

## Cómo arrancarlo

```bash
cd inventario
ADMIN_EMAIL=tucorreo@ejemplo.com ADMIN_PASSWORD='una-clave-larga-y-unica' node server.js
```

Abre http://localhost:3000

- La primera vez se crea la cuenta de **super admin** con ese correo y contraseña.
  Si no defines `ADMIN_PASSWORD`, se genera una y se muestra en la consola.
- Entra con esa cuenta y te lleva al panel `admin.html`.
- Variables opcionales: `PORT` (3000), `DATA_DIR` (./data), `COOKIE_SECURE=1` (si usas https),
  `TRUST_PROXY=1` (si está detrás de un proxy como Nginx o Caddy).

## Cómo funciona

1. El cliente crea su cuenta y entra a `suscripcion.html`.
2. Elige pago móvil, tarjeta de crédito o Binance, paga y sube la **captura** y el **número de referencia**.
3. En el panel admin (pestaña **Pagos**) ves la captura y aceptas o rechazas. Al aceptar se activan 30 días.
4. En **Suscriptores** puedes activar +30 días, bloquear, desbloquear o eliminar.
5. En **Datos de pago** cargas los datos del pago móvil, el enlace de tarjeta y los datos de Binance.

La app (`app.html`) y sus datos (`/api/data`) solo responden si la suscripción está activa.
Al vencer, el usuario no pierde sus datos: al renovar los recupera.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `server.js` | Servidor y API: cuentas, pagos, capturas, super admin, inventario por usuario |
| `public/index.html`, `auth.js` | Entrar y crear cuenta |
| `public/suscripcion.html`, `suscripcion.js` | Estado de la suscripción, datos de pago y envío de comprobante |
| `public/app.html`, `app.js` | La app de inventario |
| `public/admin.html`, `admin.js` | Panel de super admin |
| `public/common.js`, `styles.css` | Utilidades y estilos compartidos |
| `data/` | (se crea sola) base de datos, capturas e inventarios. **Haz copia de esta carpeta.** |

## Antes de publicarlo en internet

- Ponlo detrás de **https** (Caddy o Nginx con certificado gratuito de Let's Encrypt) y arranca con `COOKIE_SECURE=1 TRUST_PROXY=1`.
- Haz copias de seguridad periódicas de la carpeta `data/`.
- Los pagos se **verifican a mano**: compara cada captura y referencia con tu banco o tu Binance antes de aceptar.
