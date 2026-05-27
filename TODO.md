# TODO — AmicSport

Pendientes y mejoras. Última revisión: 2026-05-27.

## A. Bloqueantes / acción requerida

- [ ] **Rellenar `[ENTITY]` y `[CONTACT_EMAIL]`** en `locales/{es,en,ca}.json` (find-replace):
  razón social/NIF/dirección del responsable del cobro/tratamiento y email de contacto legal.
- [ ] **Revisión legal** de Términos/Privacidad por un abogado, sobre todo el derecho de
  desistimiento (art. 103 TRLGDCU para servicios de ocio en fecha concreta).
- [ ] **Clave de producción de Monei**: actualmente solo está la de test (`pk_test_`).
  Todo el sistema de pago sigue en modo test.

## B. Seguridad y correctitud

- [ ] **Programar `reconcile-payments`** en el Dashboard de Supabase (Integrations → Cron):
  POST a `https://wdidrnqjcdhmultayvgq.supabase.co/functions/v1/reconcile-payments`,
  header `x-reconcile-secret: <RECONCILE_SECRET>`, schedule `0 * * * *`. Verificar que
  `RECONCILE_SECRET` está seteado (si no, el endpoint queda sin protección).
- [ ] Probar end-to-end el reembolso con cola de admin (`PENDING_REFUND_ADMIN`) desde la página
  de pagos (`app/admin/pagos.tsx`) — QA manual con un pago real.

## C. Calidad / mantenibilidad

- [ ] Quitar los `any` restantes (listas en `app/(tabs)/index.tsx`, etc.) — `MatchActionBar` ya hecho.
- [ ] Unificar la lógica de fecha/hora duplicada (`isStarted`/`isOver`/hora de Madrid) en `lib/date.ts`.
- [ ] Migrar fechas de strings localizados (`"lun. 5 may."`) a formato ISO en BD (frágil, depende del locale).
- [ ] Detectar invitados por `user_id === null` en vez de buscar "invitado" en el nombre.
- [ ] Reducir la duplicación de rutas `app/dev/*` vs las de prod.
- [ ] Stats de perfil hardcodeadas (12 / 8 / 4.8 en `app/(tabs)/explore.tsx`) → datos reales.
- [ ] Actualizar paquetes Expo a la versión esperada (warning de compatibilidad al arrancar).
- [ ] Nota: el proyecto tiene errores de `tsc` preexistentes (estilos, `Colors`/`COLORS`); limpiar en un hilo aparte.

## D. Producto / siguientes fases

- [ ] Verificar si el pago por Bizum recoge teléfono (ajustar la Política de Privacidad si procede).
- [ ] Notificaciones: WhatsApp y push (el plan era email primero, luego estos).

## Hecho recientemente (2026-05-27)

- Pago de invitado (Opción A) + página admin de pagos. (`a6c1722`)
- Fix de seguridad: `getUserRole` solo lee `app_metadata`; `reconcile-payments` consciente de `is_guest`. (`8b6626c`)
- Migración RLS de consolidación + backups. (`e2b8783`) — **aplicada** a la BD.
- Términos de Uso y Política de Privacidad reales en es/en/ca. (`335027d`)
- Roles `'participante'` → `'participant'` normalizados en prod (25 participant / 5 admin).
- Calidad: `package.json` renombrado, `MATCH_DURATION_MS` centralizado, props de `MatchActionBar` tipadas. (`5507a56`)
- `create_matches_from_image.js` sacado del control de versiones. (`b0e2ff4`)
