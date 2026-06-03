# Análisis — Saldo de dinero para jugadores

> Estado: **análisis / propuesta**. No implementado. Última revisión: 2026-06-03.
> Relacionado: `docs/` pagos, `TODO.md` (sección D), migración de lista de espera
> `20260603000001_match_waitlist.sql`, pipeline de pagos (`payments`, `reserve_paid_slot`,
> `confirm_paid_slot`, cola de reembolsos `request_return`/`claim_returns`).

## 1. Objetivo y casos de uso

Permitir que un jugador acumule **saldo** en su cuenta y lo use para apuntarse a partidos de pago.

Disparadores que pidió el usuario:
- **Cancelaciones**: cuando un jugador cancela una plaza pagada, en vez de (o además de) devolver
  el dinero a su tarjeta vía Monei, abonarlo como saldo.
- **Ingresos**: el jugador mete dinero por adelantado (recarga) para no pagar partido a partido.
- **Lista de espera + saldo + opt-in**: un jugador en cola que tenga saldo y haya **activado una
  opción** ("pásame automáticamente si se libera plaza"), entra **directo al partido** al liberarse
  una plaza, cobrándose contra su saldo, sin pago manual ni reembolso intermedio.

Beneficios: menos comisiones/latencia de Monei (un abono interno es instantáneo y gratis), mejor UX
(promoción automática real), y fidelización (saldo retenido).

## 2. El punto crítico: implicaciones legales/contables (leer primero)

Retener dinero de clientes **no es neutro**:

- **Dinero electrónico / dinero de clientes (UE/España)**: emitir "saldo" canjeable puede caer bajo la
  Directiva de Dinero Electrónico (EMD2) y normativa del Banco de España. Suele haber una **exención de
  "red limitada"** (closed-loop) si el saldo **solo** sirve para los propios servicios de la plataforma
  (apuntarse a partidos) y no es reembolsable a voluntad como efectivo. Hay que confirmarlo con asesoría;
  condiciona todo el diseño (especialmente si se permite "sacar" saldo a la tarjeta).
- **Derecho de desistimiento / reembolso del consumidor**: no se puede **forzar** saldo en lugar de
  devolución real cuando el usuario tiene derecho a que le devuelvan el dinero. Regla de diseño:
  **el abono a saldo es siempre una OPCIÓN que el usuario elige**; la devolución a tarjeta (flujo Monei
  actual) debe seguir disponible.
- **Contabilidad**: el saldo agregado es un **pasivo** (dinero que debemos a usuarios). Hay que poder
  cuadrarlo en todo momento (suma de saldos = dinero recibido por recargas − consumido − retirado).
- **Caducidad/abandono**: decidir si el saldo caduca (y comunicarlo en Términos) o no.

> Recomendación: arrancar con **saldo closed-loop NO retirable** (solo se gasta en partidos), lo que
> minimiza el riesgo regulatorio. "Sacar a tarjeta" se evalúa aparte y probablemente quede fuera del MVP.

## 3. Modelo de datos propuesto

Fuente de verdad = **libro mayor append-only** (ledger). El saldo es la **suma** del ledger, nunca un
contador editado a mano (evita el read-modify-write que ya causó bugs en `joined_players`).

```
-- Movimientos de saldo (inmutables; nunca UPDATE/DELETE salvo correcciones con asiento inverso)
CREATE TABLE public.balance_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  env          text NOT NULL DEFAULT 'prod' CHECK (env IN ('prod','dev')),
  user_id      uuid NOT NULL,                 -- dueño del saldo (siempre usuario registrado)
  amount       integer NOT NULL,              -- céntimos; + abono, − cargo (mismo criterio que payments.amount)
  kind         text NOT NULL CHECK (kind IN (
                 'deposit',        -- recarga vía Monei
                 'refund_credit',  -- cancelación abonada a saldo (en vez de a tarjeta)
                 'match_charge',   -- cargo por apuntarse/promoción
                 'match_refund',   -- devolución a saldo al cancelar una plaza pagada con saldo
                 'admin_adjust',   -- ajuste manual del admin (regalo, corrección)
                 'withdrawal'      -- (futuro / si se permite) salida a tarjeta
               )),
  match_id     uuid,                           -- contexto si aplica
  payment_id   uuid,                           -- enlaza con payments (recarga o cargo)
  balance_after integer,                        -- saldo resultante (denormalizado para extractos/auditoría)
  note         text,
  actor_id     uuid,                            -- quién originó (admin para admin_adjust)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX balance_tx_user_idx ON public.balance_transactions (user_id, created_at);

-- Caché de saldo (opcional, para lecturas rápidas; reconciliable con el ledger)
CREATE TABLE public.player_balances (
  user_id      uuid PRIMARY KEY,
  env          text NOT NULL DEFAULT 'prod',
  balance      integer NOT NULL DEFAULT 0 CHECK (balance >= 0),  -- céntimos, nunca negativo
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

Notas:
- **Céntimos enteros** (igual que `payments.amount`), nunca floats.
- `CHECK (balance >= 0)` impide saldo negativo a nivel de BD (defensa final).
- Solo **usuarios registrados** tienen saldo (los invitados/agenda no tienen cuenta → fuera de alcance,
  consistente con el email de promoción).
- `app_settings` puede guardar límites (recarga máx., saldo máx., si se permite retirada).
- RLS: el usuario ve su propio saldo/movimientos; el admin ve todo; **solo el service role escribe**
  (igual que `payments`/`audit_log`). Todos los abonos/cargos pasan por RPCs `SECURITY DEFINER`.

## 4. Operaciones (RPCs atómicas, patrón de los pagos existentes)

Todas `SECURITY DEFINER`, `GRANT` solo a `service_role`, y **bloquean** la fila de saldo del usuario
(`SELECT ... FOR UPDATE`) para serializar cargos/abonos concurrentes — mismo patrón que `join_match`
y `reserve_paid_slot`.

- `credit_balance(user_id, amount, kind, ...)`: inserta movimiento + actualiza `player_balances`.
  Usado por recarga (`deposit`) y por reembolso-a-saldo (`refund_credit`/`match_refund`).
- `debit_balance(user_id, amount, kind, ...)`: bloquea saldo, comprueba `balance >= amount`
  (si no, error `insufficient_balance`), inserta movimiento negativo, actualiza caché.
- `charge_balance_and_join(match_id, user_id, ...)`: **operación compuesta** que en una transacción:
  (1) bloquea el partido (capacidad), (2) `debit_balance`, (3) crea el `match_participant`,
  (4) registra un `payment` con un nuevo `payment_method = 'balance'`. Si algo falla, rollback total →
  nunca se cobra sin plaza ni se da plaza sin cobrar (misma garantía que `reserve_paid_slot`).

## 5. Integración con el pipeline de pagos actual

### 5.1 Recarga (entra dinero)
Reutiliza Monei: nueva intención de pago tipo "recarga" (no ligada a partido). Al `SUCCEEDED` (webhook),
en vez de `confirm_paid_slot`, se llama `credit_balance(kind='deposit')`. El `payments.match_id` sería
NULL o un sentinel; conviene un flag/tipo en `payments` para distinguir recarga de pago-de-partido.

### 5.2 Cancelación → abono a saldo (opción del usuario)
Hoy `request_return` hace SUCCEEDED→PENDING_RETURN + borra participante + el worker llama a Monei.
Variante: si el usuario **elige "devolver a mi saldo"**, en vez de encolar el refund de Monei se hace
`credit_balance(kind='refund_credit')` y el `payment` pasa a un estado terminal tipo `REFUNDED_TO_BALANCE`.
Ventaja: instantáneo y sin comisión. **Debe convivir** con la devolución a tarjeta (derecho del consumidor).

### 5.3 Pago con saldo (alternativa a Monei al apuntarse)
En `MatchActionBar`/`useMatchActions`, si el partido `requires_payment` y el usuario tiene saldo
suficiente, ofrecer "Pagar con saldo (€X disponibles)". Llama a `charge_balance_and_join` (§4) en vez de
`createPayment` (Monei). Si no hay saldo suficiente → cae al flujo Monei normal.

### 5.4 Lista de espera + saldo + opt-in (el caso estrella)
Estado actual: el trigger `promote_waitlist_after_leave` promociona al **más antiguo en espera** (FIFO)
poniéndolo activo, **sin cobrar** (decisión previa "promocionar igual, sin pago"). Con saldo, el flujo
mejora para partidos de pago:

- Añadir a `match_participants` un flag `auto_promote_optin boolean` (el jugador en cola marca
  "entrar automáticamente si se libera plaza y cobrarme del saldo").
- Al liberarse una plaza, en lugar de promocionar a ciegas, elegir al **primer candidato válido**:
  en orden FIFO, el primero que tenga `auto_promote_optin = true` **y** saldo ≥ precio. A ese se le hace
  `debit_balance(kind='match_charge')` y se le marca activo (plaza confirmada y pagada).
- **Decisión de diseño pendiente (la clave)**: ¿prioridad estricta FIFO (si el primero en cola no tiene
  opt-in/saldo, la plaza queda libre y se le ofrece manualmente) o "salta" al siguiente que sí cumple?
  Recomendación: **respetar FIFO**, pero si el primero no tiene opt-in, no auto-promocionar a nadie y
  notificar (que decida el admin / que se apunte manualmente) — evita "colarse" por tener saldo.
- **Importante sobre atomicidad**: hoy la promoción vive en un **trigger AFTER DELETE** en Postgres.
  Cobrar saldo dentro del trigger es posible (es otra tabla) pero acopla pago y borrado y complica el
  manejo de errores (¿qué pasa si el cobro falla?). **Mejor mover la promoción-con-cobro a una RPC/Edge
  Function explícita** que: bloquea el partido, elige candidato, cobra saldo, promociona y notifica —
  todo en una transacción. El trigger quedaría solo para el caso gratis (o se elimina y se centraliza
  todo en la RPC llamada tras cada baja). Esto es un **refactor del mecanismo de promoción actual**.

## 6. Casos límite a resolver

- **Cancelar una plaza pagada con saldo** → devolver a saldo (`match_refund`), respetando el deadline
  de cancelación igual que hoy.
- **Saldo insuficiente** en promoción/auto-join → no promocionar a ese, seguir la regla FIFO elegida.
- **Reembolso parcial / precio cambiado** entre el cargo y la cancelación.
- **Doble click / concurrencia**: idempotencia vía lock de saldo + CAS, como `request_return`.
- **Borrado de usuario** con saldo > 0: política (¿se pierde? ¿se devuelve?). Implicación legal.
- **Partidos `dev` vs `prod`**: el saldo lleva `env` como `payments`.
- **Invitados**: sin cuenta → sin saldo (el host paga sus invitados con SU saldo si se permite).
- **Cuadre/reconciliación**: job que verifica `sum(balance_transactions) == player_balances.balance`
  por usuario, y que el pasivo total de saldo cuadra con (recargas − consumos − retiradas) en Monei.

## 7. UI / superficies

- **Perfil**: saldo disponible + extracto de movimientos (lee `balance_transactions`).
- **Recargar**: botón → flujo Monei de recarga.
- **Al apuntarse** a partido de pago: selector "Pagar con tarjeta / Pagar con saldo (€X)".
- **Al cancelar**: elección "Devolver a tarjeta / Abonar a mi saldo".
- **Lista de espera**: toggle por jugador "entrar automático y cobrar de saldo" (el `auto_promote_optin`).
- **Admin**: ver saldos, ajuste manual (`admin_adjust`) con nota, y panel de cuadre.

## 8. Propuesta de fases

- **Fase 0 — Legal**: confirmar exención de red limitada y redactar Términos (closed-loop, no retirable,
  caducidad). *Bloqueante real antes de tocar dinero de usuarios.*
- **Fase 1 — Núcleo de saldo**: tablas `balance_transactions` + `player_balances`, RPCs
  `credit/debit_balance`, RLS, panel de admin (ver + `admin_adjust`), extracto en perfil. Sin Monei aún
  (solo abonos manuales del admin) para probar el modelo end-to-end con bajo riesgo.
- **Fase 2 — Reembolso a saldo**: opción "devolver a mi saldo" en la cancelación (`refund_credit`),
  conviviendo con la devolución a tarjeta.
- **Fase 3 — Pago con saldo**: `charge_balance_and_join` + selector de método al apuntarse.
- **Fase 4 — Recarga vía Monei**: intención de pago "recarga" + `credit_balance(deposit)` en el webhook.
- **Fase 5 — Auto-promoción con saldo**: `auto_promote_optin` + refactor de la promoción a RPC explícita
  con cobro de saldo. (Depende de Fases 1–3.)

## 9. Riesgos / decisiones abiertas

1. **Regulatorio** (Fase 0) — el mayor riesgo; condiciona si el saldo es retirable.
2. **Refactor del trigger de promoción** a RPC para poder cobrar al promocionar (Fase 5).
3. **Prioridad FIFO vs saldo** en la auto-promoción (recomendado: FIFO estricto).
4. **Cuadre contable** — imprescindible un job de reconciliación desde el día 1 de manejar dinero.
5. **Convivencia** saldo ↔ Monei (no romper el pipeline de pagos ya endurecido contra overbooking/doble
   reembolso).
