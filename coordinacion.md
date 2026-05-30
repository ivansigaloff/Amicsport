# Coordinación de agentes — AmicSport

Doc para agentes que trabajan en el MISMO repo/working-tree, para no pisarnos.
**Convención:** antes de editar un archivo compartido, decláralo aquí (quién/qué).

_Última actualización: 2026-05-30 — **Agent-Claude** (Claude Code / Opus 4.8)._

## Quién toca qué

### `scripts/e2e-scenarios.cjs` — COMPARTIDO ⚠️
- **`payMonei`** → **Agent-Claude** — Bizum REAL **integrado + validado E2E** (cb5bf3a5 4€: `method=bizum`,
  create-payment → MONEI Bizum → unión → cancelar/reembolso, 4/4 OK). Tarjeta + Bizum en una función.
- **`scChaos` + helpers de caos** (random/REST/login-retry) → **Agent-Claude** (commit `d8a1d79`).
  Ajustes de Agent-Claude en este turno (solo dentro de `scChaos`, no en `payMonei`):
  - método de pago por precio: `bizum` solo si `match.price < 5`, si no `card`.
  - restore quirúrgico: snapshot de IDs de participantes al inicio → el barrido REST **nunca**
    borra filas pre-existentes (protege datos reales, p.ej. en `cb5bf3a5`).

### App / pagos → Agent-Claude
- `hooks/match/useMatchActions.ts` — fix cancelación de pago con varios SUCCEEDED (`816108b`).
- Edge fns `verify-payment` / `monei-webhook` / `reconcile-payments` — `created_by` en invitados de
  pago, **desplegadas** (`734840e`, deploy `--use-api`, `verify_jwt=false` en `config.toml`).
- `create-payment` + `supabase/migrations/20260530000001_reserve_paid_slot.sql` — reserva de plaza
  de PAGO **atómica** (`SELECT … FOR UPDATE`, como `join_match`) para cerrar la carrera de
  overbooking en pagos. **Código listo, FALTA aplicar migración + redeploy `create-payment`**
  (NO está vivo aún → con tests secuenciales no pasa nada).
- `scripts/e2e-payments.cjs` + `docs/PAYMENTS_AUTOMATION.md` — referencia + guía de automatización de
  pagos MONEI: **Tarjeta** (mecánica ok, pero el 3DS "Validating payment" se cuelga en headless con
  alto volumen → `timeout 25s`/FAILED; usar `4444…4414`, reintentar, espaciar), **Bizum** ✅ (tel
  `500000000`, partido `<5€`, frame `inner-bizum`, RTP async → sondear), **Google Pay** ❌ (login de
  Google), **PayPal** ❌ (no habilitado en la cuenta MONEI).

## Contrato `scChaos` ↔ `payMonei`
`scChaos` llama `await payMonei(page, redirectUrl, method)` con `method ∈ {'card','bizum'}` y espera
`{ ok, method }`. Elige `'bizum'` solo si `price < 5`. **Mantener esa firma** al integrar el Bizum real.

## Receta Bizum (test) — para `payMonei`
1. Botón Bizum en iframe `js.monei.com/v3/inner-bizum-button/` → clic por **coordenadas** del botón
   teal "MONEI Pay · bizum" (o frameLocator); no se ve por texto/rol en la página principal.
2. Form del teléfono en el frame **`inner-bizum`**: `input[name="phone"]` (type=tel).
3. Teléfono test: **`500000000`** (cualquier otro → "no registrado en Bizum").
4. **Importe manda en test:** `<5€` → E000 APROBADO ✅ (único rango fiable); `5–10€` → E506 (el de 6€
   siempre falla); `10–15€` → aprobado vía REDIRECT. ⇒ Bizum solo en partidos `<5€` (cb5bf3a5, 4€).
5. RTP asíncrono: tras "Pagar" → pantalla "Complete el pago en su app bancaria" + cuenta atrás →
   auto-aprueba a los pocos segundos → **sondear hasta SUCCEEDED** (9s era poco).

## Pendiente / handoff
- [ ] **Limpiar cruft de pagos de test** (`paisa` PENDING + `edu` SUCCEEDED huérfano en `475bf27a`, de
  validaciones): ejecutar o **programar `reconcile-payments`**. Necesita `RECONCILE_SECRET` (no está en
  `.env` → Agent-Claude no pudo correrlo). Programarlo además cierra el TODO de cron.
- [x] **Agent-Claude:** `payMonei` Bizum real integrado + validado E2E (4/4 en cb5bf3a5 4€).
- [x] **Agent-Claude:** chaos soak "con todo" preparado — `--chaos --paid --soak`: 22 usuarios, llena
  TODOS los partidos gratis con invitados, Bizum (<5€) + tarjetas rotando (`4414`/`4422`), esperas
  aleatorias 5-15min, restore relajado (limpia gratis, **deja las plazas de pago reservadas** a propósito).
- [x] Agent-Claude: fix cancelación (`816108b`) + ajustes `scChaos` (este turno).
- [x] **Desplegar** fix de cancelación a prod — ✅ live 2026-05-30 (`entry-382edd89…`, `expo export -p web` + `deploy-delta`).
- [x] **`reserve_paid_slot` aplicada + `create-payment` redeployado** — ✅ Agent-Claude 2026-05-30:
  la migración ya estaba aplicada (Local==Remote en `migration list`); redeploy de `create-payment`
  vía `supabase functions deploy --use-api` + verificado (HTTP 200, usa el RPC). **La carrera de
  overbooking en pagos está CERRADA en prod.**
- [x] **Push**: Agent-Claude empuja a `origin/main` (fast-forward, ahead 6 — commits de AMBOS agentes). _Si commiteaste algo nuevo, haz `git pull --rebase origin main` antes de seguir para no divergir._
