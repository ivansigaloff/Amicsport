# TODO — AmicSport

Pendientes y mejoras. Última revisión: 2026-05-30.

## A. Bloqueantes / acción requerida

- [ ] **Rellenar `[ENTITY]` y `[CONTACT_EMAIL]`** en `locales/{es,en,ca}.json` (find-replace):
  razón social/NIF/dirección del responsable del cobro/tratamiento y email de contacto legal.
- [ ] **Revisión legal** de Términos/Privacidad por un abogado (derecho de desistimiento, art. 103 TRLGDCU).
- [ ] **Clave de producción de Monei**: solo está la de test (`pk_test_`); todo el pago sigue en modo test.

## B. Seguridad y correctitud

- [ ] **Programar `reconcile-payments`** en el Dashboard de Supabase (Integrations → Cron):
  POST a `https://wdidrnqjcdhmultayvgq.supabase.co/functions/v1/reconcile-payments`,
  header `x-reconcile-secret: <RECONCILE_SECRET>` (ya está seteado), schedule `0 * * * *`.
- [ ] Probar end-to-end el reembolso con cola de admin (`PENDING_REFUND_ADMIN`) — QA manual con un pago real.
- [x] **Desplegar edge functions** *(✅ 2026-05-30: desplegadas con `--use-api` porque Docker no arrancaba; `verify_jwt=false` fijado en `config.toml` y verificado)* `verify-payment`, `monei-webhook`, `reconcile-payments` (`supabase functions deploy …`):
  arreglado un bug — los invitados de PAGO se creaban con `created_by = NULL`, así que por la
  RLS `participants_delete` **solo un admin** podía quitarlos (el host que pagó no podía cancelar
  su propio invitado). Ahora se setea `created_by = user_id` del que paga. *(Encontrado en e2e.)*
- [ ] Borrar el invitado de pago huérfano de pruebas en el partido PAID (solo admin):
  `DELETE FROM match_participants WHERE id='a44fba0f-c228-483e-8da7-4604e0fe0d15';`
- [x] **`reserve_paid_slot` aplicada + `create-payment` redeployado** (✅ 2026-05-30): cierra la
  carrera de overbooking en el flujo de pago (antes el "comprobar cupo" y el "crear hold PENDING"
  no eran atómicos → dos pagos simultáneos por la última plaza podían sobre-reservar). Ahora se
  reserva la plaza bajo `SELECT … FOR UPDATE` ANTES de cobrar (función `reserve_paid_slot`), y el
  hold se libera si Monei falla. Verificado en prod (HTTP 200, usa el RPC).

## C. Calidad / mantenibilidad

- [ ] **`expo-localization`**: está en `^55.0.13` pero Expo SDK 54 espera `~17.x` (cambio MAYOR).
  Revisar por qué está en 55 y alinear con testing (no tocado en el bump de deps por riesgo).
- [ ] Quitar los `any` restantes (listas en `app/(tabs)/index.tsx`, etc.).
- [ ] Detectar invitados por `user_id === null` en vez de buscar "invitado" en el nombre.
- [ ] Migrar fechas de strings localizados (`"lun. 5 may."`) a formato ISO en BD (frágil, depende del locale).
- [ ] Limpiar errores de `tsc` preexistentes (estilos faltantes, `Colors`/`COLORS`) en un hilo aparte.

## D. Producto / siguientes fases

- [ ] Notificaciones: WhatsApp y push (el plan era email primero, luego estos).

## Hecho recientemente

**2026-05-27**
- Pago de invitado (Opción A) + página admin de pagos. (`a6c1722`)
- Fix de seguridad: `getUserRole` solo `app_metadata`; `reconcile-payments` consciente de `is_guest`. (`8b6626c`)
- Migración RLS de consolidación aplicada + backups. (`e2b8783`)
- Términos de Uso y Política de Privacidad reales en es/en/ca. (`335027d`)
- Roles `'participante'` → `'participant'` normalizados en prod.
- Calidad: `package.json` renombrado, `MATCH_DURATION_MS`, props de `MatchActionBar` tipadas. (`5507a56`)
- `create_matches_from_image.js` sacado del control de versiones. (`b0e2ff4`)

**2026-05-28**
- Unificada la lógica de timing (`barcelonaNow`/`getMatchTiming` en `lib/date.ts`); 3 copias eliminadas. (`0476e3d`)
- Stats de perfil reales (conteo real de partidos; goles/valoración eliminados por no tener fuente). (`2416aa0`)
- Bump de Expo (`expo`, `expo-linking`, `expo-web-browser`) a versiones de SDK 54 + plugin `expo-web-browser`. (`ceb174f`)
- Dedup de rutas `dev/(tabs)/*` como re-exports de prod (−1079 líneas); `dev/admin/pagos` añadido. (`4ad9c8b`)
- Verificado: el pago no recoge teléfono (Bizum lo gestiona Monei); la Política de Privacidad ya es correcta.

**2026-05-30**
- Perf web (lentitud "los partidos tardan en salir"): el mapa de Google ya no
  bloquea el primer paint de la lista. `MapView` ahora es `React.lazy` (code-split)
  y se monta diferido en desktop (`requestIdleCallback`) / colapsado por defecto en
  móvil (`isMapExpanded=false`). Diagnóstico medido: el backend responde en
  ~100-700ms y los payloads son de 1-6KB — la lentitud era render de cliente + carga
  de Maps, NO la BD ni la red.
- Perf web ("se tarda en entrar a un partido"): el detalle se siembra al instante
  desde `lib/matchCache` (datos que la lista ya tiene) y revalida en 2º plano, en
  vez de mostrar spinner para un round-trip nuevo. Afecta a la ruta `/match/[id]`
  (móvil) y al panel inline de desktop.
- Pendiente de desplegar: requiere `npx expo export -p web` + deploy para que llegue
  al sitio en producción.
