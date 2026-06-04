# Análisis profundo del proyecto AmicSport

Fecha: 2026-06-04 (sustituye al análisis del 2026-05-22).
Stack: React Native + Expo (Router v6) + Supabase (PostgreSQL + Auth + RLS + Edge Functions) + Monei (pagos) + WhatsApp Cloud API.
Plataformas: iOS / Android / Web (multigraf.info/Kickerzbcn).
Alcance: ~8.090 LOC TS/TSX en `app/`+`components/`+`lib/`+`hooks/` · 23 migraciones SQL · 10 Edge Functions + `_shared`.
Rama analizada: `docs/whatsapp-integration` (17 commits por delante de `main`, **sin mergear**).

> **Nota:** el proyecto maduró enormemente desde el análisis del 2026-05-22. Los 2 hallazgos
> CRÍTICOS de seguridad de entonces (invite codes en el bundle, `role` en `user_metadata`) están
> **resueltos**, y la duplicación de `app/dev/` (~2.800 LOC) fue **eliminada**. Ver §0.

---

## TL;DR — Top hallazgos por severidad

| # | Severidad | Hallazgo | Fichero |
|---|---|---|---|
| 1 | **✅ RESUELTO** (era 🔴 CRÍTICO) | **Regresión:** la migración de waitlist reescribió `join_match` desde una versión vieja y **eliminó los guards `payment_required` y `not_validated`** → cualquier usuario entraba **gratis a un partido de pago** vía `rpc('join_match')` (la RPC es `SECURITY DEFINER`, salta la RLS). **Corregido 2026-06-04** (`20260604000000`, aplicado a prod). | `supabase/migrations/20260604000000_join_match_restore_guards.sql` |
| 2 | **🟡 Medio** | `supabase_types.ts` **sigue vacío (0 bytes)**. 67 anotaciones `: any`. Cero seguridad de tipos en queries Supabase. | `supabase_types.ts` |
| 3 | **🟡 Medio** | Rama `docs/whatsapp-integration` contiene 17 commits — la mayoría `feat()`/`security()` reales, no docs. Nombre engañoso + sin mergear a `main`. | git |
| 4 | **🟡 Medio** | `app/(tabs)/index.tsx` creció a **1.659 LOC** (era 1.585). Sigue siendo el monolito (home + MatchCard + calendario + filtros + share + admin). | `app/(tabs)/index.tsx` |
| 5 | **🟢 Bajo** | **Cero tests** unitarios/componente. El E2E vive en `scripts/*.cjs` (suite real contra Supabase/Monei — valiosa pero no cubre funciones puras). | — |
| 6 | **🟢 Bajo** | `INVITE_CODES` duplicado entre `whatsapp-webhook` y `validate-invite` (el propio código pide "unify at integration"). | `supabase/functions/whatsapp-webhook/index.ts:32` |
| 7 | **🟢 Bajo** | Pagos en **modo test** (`pk_test_`). Falta clave de producción Monei (bloqueante de negocio). | `TODO.md` |
| 8 | **🟢 Bajo** | 17 `console.*` activos (bajó de 20). | varios |

---

## 0. Qué se resolvió desde el 2026-05-22 (delta positivo)

| Hallazgo viejo (CRÍTICO/Alto) | Estado hoy |
|---|---|
| Invite codes hardcoded en el bundle del frontend | ✅ Validación server-side (`validate-invite` Edge Function); el cliente solo envía el código |
| `role`/`is_dev` en `user_metadata` (auto-elevación de privilegio) | ✅ Migrado a `app_metadata` (server-only) vía `secure_roles`; `getUserRole` solo lee `app_metadata` |
| Permisos/cancelación solo client-side (bypasseables) | ✅ `join_match`/`leave` son RPC `SECURITY DEFINER` con `SELECT … FOR UPDATE`; RLS consolidada |
| Sin enforcement invite-only server-side | ✅ `auth_is_validated()` exige `app_metadata.role` en escrituras (⚠️ pero ver hallazgo #1: `join_match` lo perdió) |
| `app/dev/` duplicado (~2.800 LOC en deriva) | ✅ Eliminado; las rutas dev son re-exports de prod |
| Email vía PHP sin auth | ⚠️ Sustituido por Edge Functions con HMAC; queda confirmar/retirar el PHP legacy |

Se añadieron además: **rate-limiting de intentos de invite** (web + WhatsApp), **HMAC `X-Hub-Signature-256`** en webhooks (Monei + WhatsApp) y `timingSafeEqual`. La postura de seguridad pasó de "crítica" a "sólida" — con la excepción del hallazgo #1.

---

## 1. Arquitectura (estado actual)

```
app/                          File-based routing (Expo Router) — app/dev/ ELIMINADO
├── _layout.tsx (104L)        Auth gate + theme + i18n + fonts + Cookies + Stack
├── login.tsx (346L)          Login + Signup (invite code) + Reset password
├── (tabs)/
│   ├── index.tsx (1659L)     🟡 Home monolítica — MatchCard + calendario + filtros + share + admin
│   ├── explore.tsx (249L)    Mapa Google Maps + filtros
│   └── menu.tsx (213L)       Perfil + logout + idiomas
├── admin/
│   ├── crear-partido.tsx (816L) 🟡 Wizard creación/edición con modales
│   ├── jugadores.tsx (266L)  Agenda de jugadores invitados
│   ├── pagos.tsx (286L)      Panel admin de pagos
│   └── whatsapp.tsx (135L)   Panel de supervisión de conversaciones WhatsApp
├── match/[id].tsx            Wrapper de components/MatchDetails
├── payment/return.tsx (113L) Retorno del checkout Monei
└── legal/                    Términos, privacidad

components/match/             Sub-componentes de MatchDetails (patrón a seguir)
├── MatchParticipantsList.tsx (384L)  Vista compacta admin: chips-filtro, check-in/color/pagado
├── MatchAdminPanel.tsx (273L)        Inscribir de agenda (buscador + crear inline + multi-select)
├── MatchActionBar.tsx (131L), MatchHeader, MatchLocationCard

hooks/match/
├── useMatch.ts (110L)        Estado del partido + permisos + deadlines
└── useMatchActions.ts (269L) toggleJoin, addGuest, setCheckin/setShirtColor/setPaid, refunds

lib/
├── supabase.ts               Cliente con UniversalStorageAdapter (web+móvil)
├── types.ts (98L)            Tipos MANUALES (Match/Payment/Participant/…) — bien mantenidos
├── date.ts (125L)            barcelonaNow/getMatchTiming (timing unificado)
├── matchCache.ts             Siembra del detalle desde la lista (perf)
└── services/                 matchService, participantService, paymentService, notificationService

supabase/
├── migrations/  (23 .sql)    Roles, RLS, pagos, waitlist, WhatsApp
└── functions/   (10 + _shared)
    ├── create-payment, verify-payment, monei-webhook, reconcile-payments, refund-payment
    ├── validate-invite, notify-promotion, send-match-notification
    └── whatsapp-webhook, whatsapp-reminders
```

### Lo que funciona bien
- **`MatchDetails` bien descompuesto** en sub-componentes + hooks — sigue siendo el ejemplo a seguir.
- **`use-env` + `fromTable()`** resuelve la dualidad prod/dev sin duplicar (ahora que `app/dev/` es re-export).
- **Capa `lib/services/`** ampliada (pagos incluidos).
- **Ingeniería de concurrencia en pagos y waitlist** de nivel alto (ver §3 y §5).

---

## 2. ✅ RESUELTO (era 🔴 CRÍTICO) — Regresión en `join_match` (bypass de pago e invite-only)

> **Corregido el 2026-06-04** con la migración `20260604000000_join_match_restore_guards.sql`,
> aplicada a prod (`db push` quirúrgico, verificado en `migration list`). Lo que sigue documenta la
> regresión tal como se encontró.

### 2.1 Qué pasó
El guard de pago **no** es un trigger de tabla: es **lógica dentro del cuerpo de `join_match`**:
- `20260601000002_paid_join_guard.sql:60-62` → `IF v_req AND NOT v_admin THEN RAISE EXCEPTION 'payment_required'`.
- `20260601000008_invite_only_enforcement.sql:48-50` → `IF NOT auth_is_validated() THEN RAISE 'not_validated'`.

La migración **`20260603000001_match_waitlist.sql`** hace `CREATE OR REPLACE FUNCTION public.join_match(...)` reescribiendo el cuerpo **entero**, y su cabecera lo delata: *"Replaces 20260529000002_join_match_capacity.sql"* — es decir, partió de la versión de capacidad del **2026-05-29**, anterior a ambos guards. Así, **revirtió silenciosamente los dos checks**. La nueva versión (líneas 33-109) no contiene `auth_is_validated` ni `requires_payment`/`payment_required`.

### 2.2 Por qué es explotable
`join_match` es `SECURITY DEFINER` y `GRANT EXECUTE … TO authenticated` (línea 112). Las funciones `SECURITY DEFINER` **se saltan la RLS**. La policy `participants_insert` sigue bloqueando *inserts directos* a partidos de pago — pero **no** aplica a la inserción que hace la propia RPC. Por tanto:

- **Bypass de pago (impacto: ingresos + integridad):** cualquier usuario autenticado y validado llama
  `supabase.rpc('join_match', { p_match_id: <partido de pago>, p_user_name: '…' })` y **obtiene plaza gratis**, saltándose Monei por completo.
- **Bypass de invite-only (impacto: menor):** una cuenta orphan no validada (creada con un código inválido antes del `signOut`) puede apuntarse a cualquier partido vía la RPC.

### 2.3 Acción — ✅ hecha
Migración `20260604000000_join_match_restore_guards.sql`: re-aplica **ambos guards** sobre la versión de
waitlist de `join_match` (`IF NOT auth_is_validated() THEN RAISE 'not_validated'` y
`IF v_req AND NOT v_admin THEN RAISE 'payment_required'`), conservando el overflow→waitlist (solo admin).
La regresión **estaba viva en prod** (la migración de waitlist figuraba aplicada en el remoto); el fix se
aplicó con un `db push` quirúrgico que dejó fuera a propósito la pendiente `20260530000002` (§7).
`join_match_as` (WhatsApp, service-role) no estaba afectada — conserva ambos guards.

---

## 3. Sistema de pagos (Monei) — punto fuerte de ingeniería

El flujo resuelve correctamente la concurrencia difícil:
- **Reserva atómica de plaza** (`reserve_paid_slot`) con `FOR UPDATE` *antes* de cobrar → cierra la carrera de overbooking entre dos pagos por la última plaza.
- **Ventana de frescura de 10 min** en holds PENDING (`20260530000002`) → un pago abandonado no bloquea la plaza 24h (evita venta perdida).
- **Edge case de late-completion resuelto** (`_shared/confirmSlot.ts` + `confirm_paid_slot`): bloquea la fila del partido, re-chequea cupo e idempotencia; si el partido se llenó mientras el hold caducaba → **`queued_return`** (encola reembolso en lugar de sobre-reservar). Las 3 rutas de confirmación (`webhook`/`verify-payment`/`reconcile`) **serializan** bajo el mismo lock.
- **Cola de reembolso asíncrona** con un único worker → no hay doble reembolso.

Riesgos aquí **operativos**, no técnicos: falta **programar `reconcile-payments` en cron** (TODO B) y la **clave de producción** Monei.

---

## 4. WhatsApp (trabajo de la rama actual)

Integración completa vía `whatsapp-webhook` (HMAC + log idempotente en `whatsapp_messages`):
- Router de comandos `ALTA` / `VOY` / `NOVOY` / `LISTA` / `ACEPTO` / `BAJA`.
- **Onboarding preservando invite-only** (exige código válido → escribe `app_metadata.role`).
- **Joins de pago reutilizan el pipeline Monei** intacto (mismo `reserve_paid_slot` + webhook existente).
- **Bajas de pago** vía `request_return` con el mismo gate de deadline que la web.
- Recordatorios proactivos (`whatsapp-reminders`: cron + plantilla + consentimiento GDPR en `consents` + dedup por destinatario V2).
- Panel de supervisión admin (`app/admin/whatsapp.tsx`).

**A vigilar:** `INVITE_CODES` duplicado respecto a `validate-invite` (el comentario lo reconoce) — unificar antes de que diverjan.

---

## 5. Lista de espera (waitlist)

`20260603000001_match_waitlist.sql`: el admin inscribe por encima de `max_players` (overflow → `waitlist=true`, FIFO por `created_at`). Un trigger `AFTER DELETE` (`promote_waitlist_after_leave`) promociona al más antiguo al liberarse plaza activa, **bloqueando la fila del partido** (`FOR UPDATE`) para que dos bajas concurrentes promocionen a personas distintas — mismo patrón de serialización que `join_match`. La lógica de waitlist es **correcta**; el problema de esta migración es colateral (§2: arrastró una versión vieja de `join_match`).

---

## 6. Deuda técnica vigente

- **`supabase_types.ts` vacío (0 bytes)** → 67 `any`. Mayor palanca de calidad pendiente: `npx supabase gen types typescript` y tipar incrementalmente. El `lib/types.ts` manual (98L) está bien pero no cubre las queries.
- **`app/(tabs)/index.tsx` (1.659 LOC)** sin partir. Refactor pendiente desde mayo (extraer `MatchCard`, `MatchCalendarBar`, hook `useMatchList()`) — más urgente ahora que creció.
- **Cero tests automatizados** in-repo. La suite E2E (`e2e-suite.cjs`, escenarios, caos/soak contra Monei real) es valiosa, pero faltan unit tests de funciones puras (`lib/date.ts`, `lib/share.ts`) que serían triviales.
- 17 `console.*` activos.

---

## 7. Anomalías de repo (2026-06-04)
- ✅ Migración `20260530000002_reserve_paid_slot_freshness.sql` se había movido **fuera** de `migrations/` (al root de `supabase/`) en el working tree → un `db reset`/entorno nuevo la habría saltado. **Restaurada** a `migrations/` (coincide con HEAD).
- ✅ `e2e-chaos-soak.log` (artefacto de test sin rastrear) → **añadido a `.gitignore`** (commit `6a23023`).
- ⚠️ **Hallazgo derivado:** `migration list` reveló que `20260530000002` **nunca se aplicó al remoto** (Local-only) — consecuencia de haber estado mal ubicada. La ventana de frescura de 10 min en holds de pago **no está viva** en prod (un hold abandonado bloquea plaza hasta 24h). Pendiente de decidir si aplicarla (ver TODO §B; el edge de late-completion ya lo cubre `confirm_paid_slot`).

---

## 8. Acción priorizada

### 🔥 Ahora (crítico)
1. ✅ **HECHO (2026-06-04)** — Guards `payment_required` + `not_validated` re-aplicados sobre la `join_match` de waitlist (`20260604000000`, aplicado a prod). La regresión estaba viva; el agujero está cerrado.
2. **Decidir sobre `20260530000002_reserve_paid_slot_freshness`** (no está en prod, §7) — aplicarla o descartarla conscientemente.

### 📋 Este sprint
2. **Programar `reconcile-payments`** en cron (Dashboard Supabase) — cierra TODO B y limpia holds de test.
3. **Renombrar/mergear** la rama: `docs/whatsapp-integration` no refleja su contenido (feat real). Considerar squash + merge a `main`.
4. **Generar `supabase_types.ts`** y empezar a sustituir `any`.
5. **Unificar `INVITE_CODES`** (whatsapp-webhook ↔ validate-invite).

### 🛠️ Medio plazo
6. **Partir `app/(tabs)/index.tsx`** en `MatchCard` + `MatchCalendarBar` + `useMatchList()`.
7. **Partir `crear-partido.tsx`** en modales + `useCreateMatchForm()`.
8. **Tests unitarios** de `lib/date.ts` / `lib/share.ts` (puras, rápidas).
9. **Clave de producción Monei** + revisión legal de Términos/Privacidad (TODO A).

---

## Anexo — métricas

| Métrica | 2026-05-22 | 2026-06-04 |
|---|---|---|
| LOC (app+components+lib+hooks) | ~6.250 | ~8.090 |
| `app/(tabs)/index.tsx` | 1.585 | 1.659 |
| Migraciones SQL | — | 23 |
| Edge Functions | 0 (PHP) | 10 + `_shared` |
| Duplicación `app/dev/` | ~2.800 LOC | 0 (eliminada) |
| `supabase_types.ts` | 1 byte | 0 bytes (sigue vacío) |
| Anotaciones `: any` | (sin medir) | 67 |
| `console.*` activos | 20 | 17 |
| Tests | 0 | 0 (+ suite E2E en `scripts/`) |
| Hallazgos CRÍTICOS de seguridad | 2 | 0 (la regresión `join_match` se corrigió el 2026-06-04) |
