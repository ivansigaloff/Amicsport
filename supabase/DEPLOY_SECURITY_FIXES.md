# Deploy de los fixes de seguridad críticos

Acompaña al commit que cierra los 2 críticos del análisis:

1. Códigos de invitación ya no viven en el bundle del frontend.
2. `role` y `is_dev` se escriben sólo desde el server (`app_metadata`), nunca desde el cliente (`user_metadata`).

Esta guía describe el orden exacto a seguir para que la app no quede rota durante el rollout.

---

## Pre-requisitos

- Tener instalado el [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
- Estar logueado: `supabase login`.
- Tener vinculado el proyecto: `supabase link --project-ref <REF>`.

---

## Orden de deploy (importa)

### 1. Aplicar la migración SQL

```bash
supabase db push
# o, si prefieres:
# supabase db execute --file supabase/migrations/20260522000000_secure_roles.sql
```

Esto:
- Copia `user_metadata.role` y `user_metadata.is_dev` de cada usuario existente a `app_metadata`.
- Crea las funciones helper `public.auth_role()` y `public.auth_is_admin()` para usar en RLS policies.

**Idempotente**: re-ejecutarlo no rompe nada.

### 2. Auditar las RLS policies

Lista las policies que aún confían en `user_metadata` (vulnerable):

```sql
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE qual LIKE '%user_metadata%' OR with_check LIKE '%user_metadata%';
```

Por cada policy listada, recrearla con `public.auth_is_admin()` o `public.auth_role()`. Ejemplo:

```sql
-- Vulnerable
DROP POLICY "admin_can_delete_matches" ON public.matches;

-- Seguro
CREATE POLICY "admin_can_delete_matches" ON public.matches
  FOR DELETE USING ( public.auth_is_admin() );
```

### 3. Configurar los secretos de la Edge Function

**Rotar los códigos** (los antiguos `ADMINKKZ2026` / `KZ2026` / `DEV_ADMIN` / `DEV_PART` ya estuvieron en el bundle público y los considera quemados):

```bash
supabase secrets set \
  INVITE_ADMIN_PROD=<código-nuevo-admin-prod> \
  INVITE_PLAYER_PROD=<código-nuevo-player-prod> \
  INVITE_ADMIN_DEV=<código-nuevo-admin-dev> \
  INVITE_PLAYER_DEV=<código-nuevo-player-dev>
```

Recomendación: cadenas alfanuméricas largas e imprevisibles (16+ chars). Estos secretos viven en Supabase, NUNCA en el repo.

### 4. Desplegar la Edge Function

```bash
supabase functions deploy validate-invite
```

`verify_jwt` queda en `true` (default), de forma que la function rechaza llamadas no autenticadas. La function usa el service-role internamente para escribir `app_metadata`.

### 5. Desplegar el frontend

```bash
npm install   # si no estaba
npm run web   # o expo start / eas build
```

El cliente:
- Ya no contiene códigos hardcoded.
- Tras `signUp`, llama a `supabase.functions.invoke('validate-invite', { body: { code } })`.
- Lee `app_metadata.role` con fallback temporal a `user_metadata.role` (ver `lib/auth.ts`).

### 6. Verificación

Crear una cuenta nueva con cada código:

```
Email: test-admin@example.com  Code: <INVITE_ADMIN_PROD>
Email: test-player@example.com Code: <INVITE_PLAYER_PROD>
```

Inspeccionar el usuario en Supabase Studio → Authentication → Users → selecciona el user → "Raw User Meta Data" y "Raw App Meta Data":

- `raw_user_meta_data` debe contener `full_name` PERO **no** `role`/`is_dev`.
- `raw_app_meta_data` debe contener `role` y `is_dev`.

Probar el ataque que estábamos cerrando, debería fallar:

```js
// Desde la consola del navegador, logueado como participant:
await supabase.auth.updateUser({ data: { role: 'admin', is_dev: false } });
// La llamada "funciona" (escribe user_metadata) pero NO da permisos
// porque las policies leen app_metadata.role y la función auth_is_admin()
// devuelve false.
```

### 7. Limpieza opcional (cuando todo verifique)

Una vez verificado que todo funciona con `app_metadata`, eliminar `role/is_dev` de `user_metadata` de los usuarios existentes (evita confusión y reduce superficie). Descomentar el bloque **STEP 2** en `migrations/20260522000000_secure_roles.sql` y volver a ejecutar:

```bash
supabase db execute --file supabase/migrations/20260522000000_secure_roles.sql
```

A continuación se puede borrar el fallback a `user_metadata.role` en `lib/auth.ts` (líneas marcadas con "Backward compat — pre-migration users").

---

## Rollback de emergencia

Si tras desplegar la function la inscripción falla y necesitas volver atrás rápido:

1. Re-deploy el frontend con la versión anterior (`git revert` del commit y push).
2. La migración SQL es idempotente — los usuarios existentes mantienen su role en AMBOS metadatos durante el período de fallback, así que un rollback del frontend NO les revoca permisos.
3. La Edge Function puede eliminarse: `supabase functions delete validate-invite`.

---

## Checklist final

- [ ] Migración SQL aplicada
- [ ] RLS policies auditadas y migradas a `auth_is_admin()` / `auth_role()`
- [ ] Secretos de la function configurados con códigos NUEVOS (no los del bundle antiguo)
- [ ] Edge Function `validate-invite` desplegada
- [ ] Frontend con los cambios desplegado
- [ ] Verificación: signUp + ataque `updateUser({ data: { role: 'admin' } })` confirmado inerte
- [ ] (Opcional) STEP 2 ejecutado y fallback a `user_metadata` retirado de `lib/auth.ts`
