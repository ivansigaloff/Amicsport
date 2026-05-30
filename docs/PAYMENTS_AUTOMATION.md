# Automatizar pagos MONEI en tests e2e (Playwright)

Guía para automatizar el flujo de pago de AmicSport en tests headless. Resume qué
método de pago se puede automatizar, los selectores/valores exactos, las trampas
(iframes, 3DS, importes) y cómo limpiar el estado.

> **Implementación de referencia:** [`scripts/e2e-payments.cjs`](../scripts/e2e-payments.cjs)
> (`node scripts/e2e-payments.cjs [--card|--bizum]`).
> El suite de caos usa los mismos helpers en `scripts/e2e-scenarios.cjs` (`payMonei`).

---

## TL;DR — qué se puede automatizar

| Método | ¿Automatizable headless? | Notas |
|---|---|---|
| **Tarjeta** | ⚠️ Sí, pero el paso **3DS** es frágil headless | Mecánica fiable; el "Validating payment" (3DS) se cuelga/timeout (25s) bajo alto volumen de test. Worked earlier, flaky now. |
| **Bizum** | ✅ Sí (fiable) | Solo importes **< 5 €** en test; teléfono test `500000000`; flujo RTP **asíncrono** (hay que sondear). |
| **Google Pay** | ❌ No | Abre login de `accounts.google.com`; necesita una sesión Google real con tarjeta. |
| **PayPal** | ❌ No (no habilitado) | No aparece en el checkout: no está activado en la cuenta MONEI. |

---

## El flujo de pago (común a todos)

1. La app llama a la Edge Function **`create-payment`** → devuelve `{ order_id, redirectUrl }`
   y crea una fila `payments` en estado `PENDING` (el "hold").
2. El navegador va a `redirectUrl` → **página alojada de MONEI** (`secure.monei.com/payments/<id>`).
3. El usuario paga (tarjeta / Bizum / GPay…). MONEI redirige a `completeUrl`
   = `<base>/payment/return?order_id=…&status=SUCCEEDED`.
4. El pago se confirma server-side por **webhook** (`monei-webhook`) y/o por la página
   `/payment/return` (que llama a `verify-payment`), que **crea el participante** y pone
   el pago en `SUCCEEDED`.

**Disparar `create-payment` directamente por REST** (sin pasar por la app) es lo más
rápido para tests:
```js
const r = await fetch(`${SB_URL}/functions/v1/create-payment`, {
  method:'POST',
  headers:{ apikey: ANON, Authorization:`Bearer ${userToken}`, 'Content-Type':'application/json' },
  body: JSON.stringify({ match_id: MATCH_ID, env:'prod' /*, guest_name:'X (invitado)' para invitado */ }),
});
const { order_id, redirectUrl } = await r.json();
```
Notas:
- Devuelve `409 already_paid` si el usuario ya tiene un pago `SUCCEEDED` en ese partido
  (el chequeo se **salta para invitados** → un invitado siempre llega al pago).
- Si el usuario tiene un `PENDING`, devuelve **ese mismo** (no crea otro).
- El método de pago **no se fuerza** (no manda `allowedPaymentMethods`) → en el checkout
  salen los métodos **activados en la cuenta MONEI** (hoy: Bizum, Google Pay, Tarjeta).

**Comprobar que el pago completó** (no fíes del navegador; sondea la BD):
```js
// payments: RLS deja al usuario LEER los suyos (user_id = auth.uid())
GET ${SB_URL}/rest/v1/payments?order_id=eq.<order_id>&select=status,payment_method
// estado != 'PENDING' (idealmente 'SUCCEEDED') = resuelto
```

---

## Tarjeta

Datos de test MONEI (cualquier importe): **expiry `12/34`, CVC `123`**.
| Tarjeta | Comportamiento |
|---|---|
| `4444444444444414` | **Aprobación directa, SIN challenge** ← preferida para automatizar |
| `4444444444444422` | 3DS v2.1 **frictionless** (muestra "Validating payment") |
| `4444444444444406` | Requiere challenge 3DS (pide código) — no usar en automatización |

**Selectores** (los campos de tarjeta viven en un iframe `js.monei.com/v3/inner-card-input/`;
`billingName` está en la página principal y es **OBLIGATORIO** o el submit se bloquea):
```js
// iterar [page, ...page.frames()] y rellenar el primero visible:
'input[autocomplete="cc-number"]'  // nº tarjeta  (iframe)
'input[autocomplete="cc-exp"]'     // MM/AA       (iframe)
'input[autocomplete="cc-csc"]'     // CVC         (iframe)
'input[name="billingName"]'        // nombre      (página principal) ← REQUERIDO
// enviar:
'button:has-text("Pagar")'
```
El iframe carga **un pelín después** que la página → reintenta el `isVisible/fill` por campo
(p.ej. 12×500 ms) o el campo queda vacío → pago FAILED.

### ⚠️ Trampa 3DS (importante)
Tras "Pagar", MONEI puede mostrar un paso **"Validating payment"** (3DS, URL `…/challenge`).
En headless ese 3DS **se cuelga y termina en `FAILED` con `error_message: "timeout of 25000ms exceeded"`**
(la huella de dispositivo / el reto 3DS no completa en un navegador automatizado, y MONEI
escala a 3DS más agresivamente bajo **alto volumen de pagos de test**). La misma tarjeta
funcionó antes en el día con poco volumen. Mitigaciones:
- Usar `4444444444444414` (aprobación directa) para minimizar el 3DS.
- Mantener la página **abierta** y sondear el estado (no cerrar durante "Validating payment").
- **Reintentar** y **espaciar** las ejecuciones (el 3DS se relaja con menos volumen).
- Si necesitas fiabilidad 100% en tarjeta, considera ejecutar **no-headless** (el 3DS pasa mejor).

---

## Bizum ✅ (el más fiable en test)

**Restricciones de test (de [docs.monei.com/testing](https://docs.monei.com/testing/)):**
- Teléfono de test **`500000000`** (`+34 500000000`) — el único "registrado". Otro → *"El número de teléfono no está registrado en Bizum"*.
- **El importe manda:** **< 5 € → APROBADO** · 5–10 € → error E506 · 10–15 € → aprobado (REDIRECT) · > 15 € → "no registrado".
  → **usa un partido de pago de < 5 €** (p.ej. el de 4 €). En uno de 6 € Bizum SIEMPRE falla.

**Pasos:**
```js
// 1. El botón Bizum ("MONEI Pay · bizum") es un iframe-render (logo, sin texto seleccionable)
//    → clic por COORDENADA en el botón teal (viewport 430×920 ≈ (215, 395)):
await page.mouse.click(215, 395);
await sleep(4000);
// 2. El formulario del teléfono está en el frame inner-bizum:
const bz = page.frames().find(f => /inner-bizum\//.test(f.url()) && !/-button/.test(f.url()));
await bz.locator('input[type="tel"]').first().fill('500000000');
await bz.locator('button:has-text("Pagar")').first().click();
// 3. Sale "Complete el pago en su aplicación bancaria" (RTP). Para <5€ se AUTO-APRUEBA
//    de forma ASÍNCRONA (segundos). NO redirige al instante → SONDEA el estado:
const st = await waitPaid(token, order_id, 90000); // hasta ~90s
```

---

## Google Pay ❌

El botón (frame `js.monei.com/v3/inner-payment-request/`) es clicable, pero abre un **popup
a `accounts.google.com/signin`**: requiere **iniciar sesión en una cuenta Google** con tarjeta
guardada. (Por eso funciona manualmente: tu navegador ya tiene sesión Google; el navegador
headless del test no.) Google bloquea logins automatizados + detección de bots → **no
automatizable de forma fiable**. Déjalo para prueba **manual**.

## PayPal ❌ (no habilitado)

No aparece en el checkout porque **no está activado en la cuenta MONEI** (solo están Bizum,
Google Pay y Tarjeta). Los correos PayPal de la doc de test son genéricos. Para usarlo habría
que activarlo en el dashboard de MONEI (y enlazar cuenta PayPal). Aun así requeriría login en
`paypal.com` (sandbox) → semi-automatizable, como Google Pay.

---

## Limpieza (¡importante!)

- La tabla `payments` **solo tiene policy de SELECT** para usuarios → un usuario **NO** puede
  borrar/cancelar filas `payments`. Solo **admin/service-role**. Los `PENDING` abandonados y
  los `SUCCEEDED` de test quedan como basura hasta que los borre un admin o los expire
  `reconcile-payments` (que **no está programado** — ver TODO.md).
- Para **revertir** una plaza pagada de forma limpia: cancelar **vía la app** (`Cancelar Plaza`
  → confirma → `refund-payment`), que reembolsa (test mode) y libera la plaza. Requiere que
  `app_settings.daily_refund_count_limit` sea alto (está en 999 para testing; por defecto 10).
- SQL de limpieza de basura de test (solo admin, SQL editor):
  ```sql
  -- holds PENDING en un partido de test:
  DELETE FROM payments WHERE status='PENDING' AND match_id='<match_id>';
  -- todos los pagos de usuarios de test en un partido (cuidado si hay runs en paralelo):
  DELETE FROM payments WHERE match_id='<match_id>'
    AND user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@testusers.com');
  ```

## Notas de concurrencia / contexto
- El cupo del partido es el único invariante que necesita atomicidad: gratis ya es atómico
  (`join_match`, `SELECT … FOR UPDATE`); el de pago usa `reserve_paid_slot` (ver
  `supabase/migrations/20260530000001_reserve_paid_slot.sql` — **aplicar + redeploy
  `create-payment`** si aún no está). Tests **secuenciales** no disparan la carrera.
- Usuarios de test: `<nombre>@testusers.com`, password `TestKKZ1!`. Si dos agentes corren a la
  vez, **particionad usuarios Y partidos** (los checks globales se contaminan si comparten partido).
