# Coordinación de agentes — AmicSport

Doc para agentes que trabajan en el MISMO repo/working-tree, para no pisarnos.
**Convención:** antes de editar un archivo compartido, decláralo aquí (quién/qué).

_Última actualización: 2026-05-30 — **Agent-Claude** (Claude Code / Opus 4.8)._

## Quién toca qué

### `scripts/e2e-scenarios.cjs` — COMPARTIDO ⚠️
- **`payMonei`** → **otro agente**. Tiene la receta Bizum validada E2E (abajo); la integra él.
  **Agent-Claude NO toca `payMonei`** (ahora mismo tiene un Bizum *best-effort* mío de `d8a1d79`
  con teléfono `600000000` y sin esperar el async — sustitúyelo por el real).
- **`scChaos` + helpers de caos** (random/REST/login-retry) → **Agent-Claude** (commit `d8a1d79`).
  Ajustes de Agent-Claude en este turno (solo dentro de `scChaos`, no en `payMonei`):
  - método de pago por precio: `bizum` solo si `match.price < 5`, si no `card`.
  - restore quirúrgico: snapshot de IDs de participantes al inicio → el barrido REST **nunca**
    borra filas pre-existentes (protege datos reales, p.ej. en `cb5bf3a5`).

### App / pagos → Agent-Claude
- `hooks/match/useMatchActions.ts` — fix cancelación de pago con varios SUCCEEDED (`816108b`).
- Edge fns `verify-payment` / `monei-webhook` / `reconcile-payments` — `created_by` en invitados de
  pago, **desplegadas** (`734840e`, deploy `--use-api`, `verify_jwt=false` en `config.toml`).

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
- [ ] **Otro agente:** integrar el `payMonei` Bizum real (receta arriba) en `e2e-scenarios.cjs`.
- [x] Agent-Claude: fix cancelación (`816108b`) + ajustes `scChaos` (este turno).
- [ ] **Desplegar** fix de cancelación a prod (Agent-Claude, en curso — `expo export -p web` + deploy).
- [ ] **Push**: hay commits locales sin pushear. Coordinar quién pushea para no divergir.
