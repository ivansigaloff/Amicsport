# TODO — AmicSport

Pendientes y mejoras. Última revisión: 2026-05-31.

## A. Bloqueantes / acción requerida

- [ ] **Rellenar `[ENTITY]` y `[CONTACT_EMAIL]`** en `locales/{es,en,ca}.json` (find-replace):
  razón social/NIF/dirección del responsable del cobro/tratamiento y email de contacto legal.
- [ ] **Revisión legal** de Términos/Privacidad por un abogado (derecho de desistimiento, art. 103 TRLGDCU).
- [ ] **Clave de producción de Monei**: solo está la de test (`pk_test_`); todo el pago sigue en modo test.

## B. Seguridad y correctitud

- [x] **`20260604000000_join_match_restore_guards.sql` aplicada en prod** *(✅ 2026-06-04: regresión
  CRÍTICA cerrada, verificado en `migration list` Local==Remote)*.
  `20260603000001_match_waitlist.sql` reescribió `join_match` desde la versión vieja de capacidad
  (2026-05-29) y **dropeó los guards `payment_required` + `not_validated`** que añadieron
  `paid_join_guard` (0601000002) e `invite_only_enforcement` (0601000008). Como la RPC es
  `SECURITY DEFINER` + `GRANT TO authenticated`, salta la RLS → cualquier usuario podía entrar
  **gratis a un partido de pago** vía `rpc('join_match')` (la regresión estaba **viva en prod**). La
  migración nueva re-aplica ambos guards conservando el waitlist (overflow solo-admin). Aplicada con
  `db push` quirúrgico (solo esta migración; la pendiente `20260530000002` se dejó fuera a propósito).
  `join_match_as` (WhatsApp, service-role) NO estaba afectada.
- [ ] **`20260530000002_reserve_paid_slot_freshness` NO está en prod** (descubierto 2026-06-04 vía
  `migration list`: Local-only). El archivo estuvo mal ubicado fuera de `migrations/`, por eso ningún
  `db push` la aplicó. Efecto: la ventana de frescura de 10 min en holds de pago no está viva → un hold
  abandonado bloquea plaza hasta 24h. Decidir si aplicarla (cambia comportamiento de pagos; el edge de
  late-completion ya lo cubre `confirm_paid_slot`).
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

- [ ] **Saldo en la cuenta del jugador** — análisis hecho en **`docs/ANALISIS_SALDO_JUGADORES.md`**.
  Idea: acumular saldo por cancelaciones/reembolsos o ingresos directos; jugadores en lista de espera
  con saldo + opt-in que pasan directos al partido (cobro contra saldo). El doc cubre modelo de datos
  (ledger `balance_transactions` + caché `player_balances`), RPCs atómicas, integración con el pipeline
  Monei, el refactor del trigger de promoción FIFO (`20260603000001_match_waitlist.sql`) y, sobre todo,
  el **bloqueante legal** (dinero electrónico / exención red limitada). Pendiente: Fase 0 legal antes de
  tocar dinero de usuarios.

- [ ] Notificaciones: WhatsApp y push (el plan era email primero, luego estos).
- [ ] **Aplicar migración Fase B** `supabase/migrations/20260531000000_participant_match_management.sql`
  (`checked_in`/`shirt_color`/`paid` en `match_participants`). El código (tipos, `updateParticipant`,
  `setCheckin`/`setShirtColor`/`setPaid`, botones activos) ya está cableado y commiteado. **NO desplegar
  la Fase B hasta aplicar la migración** (si no, los toggles de check-in/color/pagado darán error por
  columna inexistente). `paid` solo en modo test (`EXPO_PUBLIC_PAYMENTS_TEST_MODE`).

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

**2026-05-31**
- Check-in / gestión de partido (Fase A): vista compacta admin en `MatchParticipantsList`,
  optimizada para móvil de campo. Cabecera = 5 chips icono+número que **filtran** la lista
  (check-in, pagado, blanco, negro, sin asignar; blanco/negro/sin-asignar mutuamente
  excluyentes, check-in/pagado independientes). Filas tintadas por color de equipo, **sin
  cabeceras de sección**, no asignados arriba. Toggle compacto↔ampliada; en compacto se oculta
  la tarjeta de sede/distancia (`MatchLocationCard`; estado `compact` subido a `MatchDetails`).
  **Tooltips** en todos los iconos (`title` vía ref en web — RN-web 0.21 no reenvía `title` — +
  `aria-label`). Botones de check-in / color (B/N) / pagado visibles pero DESACTIVADOS (se
  cablean en Fase B). No-admin mantiene la lista simple. i18n es/en/ca (`match_details.manage.*`).
  `tsc` limpio + desplegado.
- Check-in / gestión (Fase B, cableado — **pendiente aplicar migración + desplegar**): columnas
  `checked_in`/`shirt_color`/`paid` (migración `20260531000000`), `Participant` ampliado,
  `updateParticipant` en el servicio, `setCheckin`/`setShirtColor`/`setPaid` (update optimista) y
  botones de la vista compacta **activos** (check-in, color B/N con toggle, pagado solo en modo test).
- Inscribir de Agenda: buscador en el modal + si no hay coincidencias, fila "Crear jugador: «nombre»"
  que crea en `admin_players` e inscribe en un toque; **checkboxes de multi-selección** (la selección
  persiste entre búsquedas) con **botón flotante "Añadir (N)"** que inscribe a todos a la vez
  (`MatchAdminPanel`). i18n es/en/ca.
- Crear partido: el formato se deriva de las plazas (14 → "7 vs 7", solo lectura) y se guarda también
  al editar; el campo "Enlace Google Maps" pasó a estar debajo de Nivel/Formato (`crear-partido.tsx`).
