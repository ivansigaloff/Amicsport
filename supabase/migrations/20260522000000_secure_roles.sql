-- Migration: secure_roles
-- Date: 2026-05-22
--
-- Issue addressed (CRÍTICO #2 del análisis):
--   El rol del usuario se guardaba en `raw_user_meta_data` (alias user_metadata)
--   que es user-controlled vía supabase.auth.updateUser. Cualquier usuario podía
--   auto-elevarse a admin.
--
-- Fix:
--   Mover `role` y `is_dev` a `raw_app_meta_data` (alias app_metadata) que SOLO
--   es escribible con la service-role key. El cliente puede LEER ambos campos
--   pero sólo el backend puede ESCRIBIR `app_metadata`.
--
-- After running this migration:
--   1. Deploy the validate-invite Edge Function (sólo el server escribe roles).
--   2. Update RLS policies that compared `auth.jwt() -> 'user_metadata' ->> 'role'`
--      to use `auth.jwt() -> 'app_metadata' ->> 'role'` instead.
--   3. Frontend ya lee `app_metadata.role` (cambio en el commit acompañante).
--   4. Tras verificar todo, considerar borrar `role` y `is_dev` de user_metadata
--      para evitar confusión (ver bloque opcional al final).

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: Migrar role/is_dev de user_metadata → app_metadata
--         para los usuarios que ya existen.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE auth.users
SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
        'role',   COALESCE(raw_user_meta_data ->> 'role',   'participant'),
        'is_dev', COALESCE((raw_user_meta_data ->> 'is_dev')::boolean, false)
    )
WHERE raw_user_meta_data ? 'role' OR raw_user_meta_data ? 'is_dev';

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2 (opcional, recomendado tras verificar):
--         Eliminar role/is_dev de user_metadata para evitar lectura accidental
--         desde el cliente con la variable "antigua".
--
-- Descomenta y ejecuta MANUALMENTE en una segunda ronda, sólo cuando el
-- frontend YA esté usando app_metadata en producción y se hayan verificado
-- los flujos de admin.
-- ────────────────────────────────────────────────────────────────────────────
-- UPDATE auth.users
-- SET raw_user_meta_data = raw_user_meta_data - 'role' - 'is_dev'
-- WHERE raw_user_meta_data ? 'role' OR raw_user_meta_data ? 'is_dev';

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 3: Helper para policies — devuelve el rol del JWT actual desde app_metadata.
--         Útil para RLS policies sin tener que repetir el cast en cada policy.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', 'participant')
$$;

CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 4: AUDITAR Y ACTUALIZAR RLS POLICIES (MANUAL).
--
-- Si tienes policies que lean user_metadata.role o user_metadata.is_dev,
-- migrarlas a app_metadata / auth_role() / auth_is_admin(). Ejemplos típicos:
--
--   -- ANTES (vulnerable):
--   CREATE POLICY "admin_can_delete_matches" ON public.matches
--     FOR DELETE USING (
--       auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
--     );
--
--   -- DESPUÉS (seguro):
--   CREATE POLICY "admin_can_delete_matches" ON public.matches
--     FOR DELETE USING ( public.auth_is_admin() );
--
-- Lista las policies sospechosas con:
--   SELECT schemaname, tablename, policyname, qual
--   FROM pg_policies
--   WHERE qual LIKE '%user_metadata%' OR with_check LIKE '%user_metadata%';
-- ────────────────────────────────────────────────────────────────────────────
