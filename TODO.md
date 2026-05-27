# TODO — AmicSport

Pendientes y mejoras. Última revisión: 2026-05-27.

## A. Bloqueantes / acción requerida

- [ ] **Aplicar migración RLS** `supabase/migrations/20260527000002_consolidate_rls_policies.sql`.
  Revisar los `REVIEW:` del fichero, hay backup en `supabase/backups/`, luego `supabase db push`.
  **Crítico de seguridad**: hasta aplicarla, cualquier usuario autenticado puede crear/borrar
  partidos y participantes — el gating de admin es solo de UI.
- [ ] **Rellenar `[ENTITY]` y `[CONTACT_EMAIL]`** en `locales/{es,en,ca}.json` (find-replace):
  razón social/NIF/dirección del responsable del cobro/tratamiento y email de contacto legal.
- [ ] **Revisión legal** de Términos/Privacidad por un abogado, sobre todo el derecho de
  desistimiento (art. 103 TRLGDCU para servicios de ocio en fecha concreta).
- [ ] **Clave de producción de Monei**: actualmente solo está la de test (`pk_test_`).
  Todo el sistema de pago sigue en modo test.

## B. Seguridad y correctitud

- [ ] Normalizar el rol `'participante'` → `'participant'` en datos de producción (varias cuentas
  tienen la grafía española; hoy no rompe porque se usa `auth_is_admin()`, pero es deuda latente).
- [ ] Decidir qué hacer con `create_matches_from_image.js` (tiene cambios sin commitear en el árbol
  desde antes de la sesión del 2026-05-27).
- [ ] Verificar si `reconcile-payments` está programado (cron/pg_cron); si no, programarlo.
- [ ] Probar end-to-end el reembolso con cola de admin (`PENDING_REFUND_ADMIN`) desde la página
  de pagos (`app/admin/pagos.tsx`).

## C. Calidad / mantenibilidad

- [ ] Quitar los `any` de props (`MatchActionBar`, `useMatchActions`, listas en `app/(tabs)/index.tsx`).
- [ ] Centralizar la lógica de fecha/hora duplicada (`isStarted`/`isOver`/hora de Madrid) en `lib/date.ts`.
- [ ] Migrar fechas de strings localizados (`"lun. 5 may."`) a formato ISO en BD (frágil, depende del locale).
- [ ] Detectar invitados por `user_id === null` en vez de buscar "invitado" en el nombre.
- [ ] Reducir la duplicación de rutas `app/dev/*` vs las de prod.
- [ ] Stats de perfil hardcodeadas (12 / 8 / 4.8 en `app/(tabs)/explore.tsx`) → datos reales.
- [ ] Renombrar `package.json` (`"celebreak_clone"` → AmicSport).
- [ ] Duración de partido (2h) hardcodeada en varios sitios → constante compartida.
- [ ] Actualizar paquetes Expo a la versión esperada (warning de compatibilidad al arrancar).

## D. Producto / siguientes fases

- [ ] Verificar si el pago por Bizum recoge teléfono (ajustar la Política de Privacidad si procede).
- [ ] Notificaciones: WhatsApp y push (el plan era email primero, luego estos).

## Hecho recientemente (2026-05-27)

- Pago de invitado (Opción A): el anfitrión paga la plaza del invitado vía Monei. (`a6c1722`)
- Página admin de pagos con filtros y reembolso/forzar reembolso. (`a6c1722`)
- Fix de seguridad: `getUserRole` solo lee `app_metadata`; `reconcile-payments` consciente de `is_guest`. (`8b6626c`)
- Migración RLS de consolidación + backups, **escrita pero sin aplicar**. (`e2b8783`)
- Términos de Uso y Política de Privacidad reales en es/en/ca. (`335027d`)
