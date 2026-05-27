-- Migration: consolidate_rls_policies   (PROPUESTA — REVISAR ANTES DE APLICAR)
-- Date: 2026-05-27
--
-- PROBLEMA QUE RESUELVE
-- ─────────────────────
-- RLS está activado en todas las tablas, pero las políticas acumuladas a lo largo
-- del tiempo ("policy sprawl") dejan las escrituras efectivamente abiertas:
--
--   1. Helpers basados en user_metadata (escribible por el usuario vía updateUser):
--        auth_is_dev()  -> leía user_metadata.is_dev
--        auth_is_read() -> leía user_metadata.is_read
--      Esto es el mismo fallo que secure_roles arregló para `role`, pero quedó
--      pendiente para is_dev. (auth_role/auth_is_admin ya leen app_metadata ✓)
--
--   2. Semántica OR de Postgres: varias políticas PERMISSIVE por comando se
--      combinan con OR -> gana la MÁS permisiva. Las "strict_*" se escribieron con
--      intención restrictiva pero al ser permissive en realidad CONCEDEN acceso.
--      Resultado concreto:
--        - matches INSERT: "Admins (cualquier usuario)" with_check auth.role()='authenticated'
--            -> cualquier logueado crea partidos
--        - matches DELETE/UPDATE: "strict_production_isolation" USING auth_is_dev() IS NOT TRUE
--            -> cualquier no-dev borra/edita cualquier partido
--        - match_participants INSERT: "Permitir inscripcion de agenda" with_check true
--            -> cualquiera inserta filas arbitrarias
--        - match_participants DELETE: "strict_participants_isolation" USING auth_is_dev() IS NOT TRUE
--            -> cualquier no-dev expulsa a cualquiera de cualquier partido
--        - saved_locations: "...global" true/true -> totalmente abierto
--
-- ENFOQUE
-- ───────
--   Parte 1: reescribir auth_is_dev() para leer app_metadata (server-controlado).
--   Parte 2: BORRAR todas las políticas de las 8 tablas core (pizarra limpia).
--   Parte 3: reasegurar RLS activado.
--   Parte 4: recrear UNA política clara por comando y tabla.
--
-- DECISIONES MARCADAS CON "REVIEW:" — confírmalas o ajústalas antes de aplicar.
--
-- SEGURIDAD ANTES DE APLICAR (recomendado):
--   pg_dump --schema-only de las policies, o exportar pg_policies a CSV, para
--   poder revertir. Esta migración DROPa políticas existentes (irreversible sin
--   ese respaldo). El conjunto se aplica en una transacción, así que o entra todo
--   o nada.

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — Helper auth_is_dev() pasa a leer app_metadata (no user_metadata)
-- ════════════════════════════════════════════════════════════════════════════
-- secure_roles (STEP 1) ya copió is_dev a app_metadata para usuarios existentes,
-- y validate-invite escribe app_metadata.is_dev en altas nuevas. Por tanto el
-- cambio es seguro: misma fuente de verdad que role.
CREATE OR REPLACE FUNCTION public.auth_is_dev()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_dev')::boolean, false)
$$;

-- NOTA: auth_is_read() (lee user_metadata.is_read) queda SIN USAR tras esta
-- migración (la única policy que lo usaba se elimina). No se toca para no
-- introducir efectos colaterales. Considera borrarla en una limpieza posterior.

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — Pizarra limpia: borrar TODAS las políticas de las 8 tablas core
-- ════════════════════════════════════════════════════════════════════════════
-- Drop dinámico para garantizar que no queda ninguna policy permisiva colgando
-- (si quedara una sola con "true", el agujero persiste por la semántica OR).
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'matches', 'match_participants', 'admin_players', 'saved_locations',
        'matches_dev', 'match_participants_dev', 'admin_players_dev', 'saved_locations_dev'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — Reasegurar RLS activado (idempotente)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.matches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_participants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_players            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_locations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches_dev             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_participants_dev   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_players_dev        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_locations_dev      ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 4 — Políticas limpias (UNA por comando)
-- ════════════════════════════════════════════════════════════════════════════
-- Convenciones:
--   auth_is_admin()  -> app_metadata.role = 'admin'        (seguro)
--   auth_is_dev()    -> app_metadata.is_dev = true         (seguro tras Parte 1)
--   auth.uid()       -> UUID del usuario del JWT
--   auth.role()      -> rol Postgres: 'authenticated' | 'anon'
--   PROD: admins NO-dev gestionan.  DEV: admins dev gestionan en el sandbox.

-- ─────────────────────────── matches (PROD) ────────────────────────────────
-- REVIEW: SELECT público (true) porque los partidos son compartibles por enlace.
--         Si quieres exigir login, cambia a: auth.role() = 'authenticated'.
CREATE POLICY "matches_select" ON public.matches
  FOR SELECT USING (true);

CREATE POLICY "matches_insert_admin" ON public.matches
  FOR INSERT WITH CHECK (auth_is_admin() AND NOT auth_is_dev());

CREATE POLICY "matches_update_admin" ON public.matches
  FOR UPDATE USING (auth_is_admin() AND NOT auth_is_dev())
             WITH CHECK (auth_is_admin() AND NOT auth_is_dev());

CREATE POLICY "matches_delete_admin" ON public.matches
  FOR DELETE USING (auth_is_admin() AND NOT auth_is_dev());

-- ──────────────────────── match_participants (PROD) ─────────────────────────
CREATE POLICY "participants_select" ON public.match_participants
  FOR SELECT USING (true);

-- INSERT: admin (añade a cualquiera) o usuario logueado apuntándose a SÍ MISMO
-- (user_id = uid) o añadiendo un INVITADO (user_id IS NULL).
-- REVIEW: permitir user_id IS NULL mantiene el flujo de invitados GRATIS, pero
--         deja que cualquier logueado inserte filas de invitado. Los invitados de
--         PAGO los crea la Edge Function con service_role (salta RLS), así que no
--         dependen de esta policy. Si quieres cerrar el invitado-gratis a no-admins,
--         quita "OR user_id IS NULL".
CREATE POLICY "participants_insert" ON public.match_participants
  FOR INSERT WITH CHECK (
    auth_is_admin()
    OR (auth.role() = 'authenticated' AND (user_id = auth.uid() OR user_id IS NULL))
  );

CREATE POLICY "participants_update_admin" ON public.match_participants
  FOR UPDATE USING (auth_is_admin()) WITH CHECK (auth_is_admin());

-- DELETE: admin, o el propio usuario se da de baja, o un logueado quita un
-- invitado (user_id IS NULL). Cierra el agujero de "borrar la plaza de OTRO usuario
-- registrado". REVIEW: mismo trade-off que el INSERT con user_id IS NULL.
CREATE POLICY "participants_delete" ON public.match_participants
  FOR DELETE USING (
    auth_is_admin()
    OR user_id = auth.uid()
    OR (auth.role() = 'authenticated' AND user_id IS NULL)
  );

-- ─────────────────────────── admin_players (PROD) ──────────────────────────
-- Directorio/agenda de jugadores: herramienta de admin (lectura y escritura).
CREATE POLICY "admin_players_all_admin" ON public.admin_players
  FOR ALL USING (auth_is_admin() AND NOT auth_is_dev())
          WITH CHECK (auth_is_admin() AND NOT auth_is_dev());

-- ────────────────────────── saved_locations (PROD) ─────────────────────────
-- Sedes guardadas: las lee la pantalla de crear-partido (admin); escritura admin.
-- REVIEW: SELECT exige login. Si la usas en algún contexto público, pon true.
CREATE POLICY "locations_select_auth" ON public.saved_locations
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "locations_write_admin" ON public.saved_locations
  FOR ALL USING (auth_is_admin() AND NOT auth_is_dev())
          WITH CHECK (auth_is_admin() AND NOT auth_is_dev());

-- ════════════════════════════════════════════════════════════════════════════
-- TABLAS DEV (sandbox) — solo usuarios con is_dev. REVIEW: ajusta si tu flujo de
-- pruebas necesita roles distintos. Escrituras = admin dev; altas/bajas propias
-- y de invitados permitidas a cualquier usuario dev.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── matches_dev ───────────────────────────────────
CREATE POLICY "matches_dev_select" ON public.matches_dev
  FOR SELECT USING (auth_is_dev());
CREATE POLICY "matches_dev_insert" ON public.matches_dev
  FOR INSERT WITH CHECK (auth_is_admin() AND auth_is_dev());
CREATE POLICY "matches_dev_update" ON public.matches_dev
  FOR UPDATE USING (auth_is_admin() AND auth_is_dev())
             WITH CHECK (auth_is_admin() AND auth_is_dev());
CREATE POLICY "matches_dev_delete" ON public.matches_dev
  FOR DELETE USING (auth_is_admin() AND auth_is_dev());

-- ──────────────────────── match_participants_dev ───────────────────────────
CREATE POLICY "participants_dev_select" ON public.match_participants_dev
  FOR SELECT USING (auth_is_dev());
CREATE POLICY "participants_dev_insert" ON public.match_participants_dev
  FOR INSERT WITH CHECK (
    auth_is_dev() AND (auth_is_admin() OR user_id = auth.uid() OR user_id IS NULL)
  );
CREATE POLICY "participants_dev_update" ON public.match_participants_dev
  FOR UPDATE USING (auth_is_admin() AND auth_is_dev())
             WITH CHECK (auth_is_admin() AND auth_is_dev());
CREATE POLICY "participants_dev_delete" ON public.match_participants_dev
  FOR DELETE USING (
    auth_is_dev() AND (auth_is_admin() OR user_id = auth.uid() OR user_id IS NULL)
  );

-- ─────────────────────────── admin_players_dev ─────────────────────────────
CREATE POLICY "admin_players_dev_all" ON public.admin_players_dev
  FOR ALL USING (auth_is_admin() AND auth_is_dev())
          WITH CHECK (auth_is_admin() AND auth_is_dev());

-- ────────────────────────── saved_locations_dev ────────────────────────────
CREATE POLICY "locations_dev_select" ON public.saved_locations_dev
  FOR SELECT USING (auth_is_dev());
CREATE POLICY "locations_dev_write" ON public.saved_locations_dev
  FOR ALL USING (auth_is_admin() AND auth_is_dev())
          WITH CHECK (auth_is_admin() AND auth_is_dev());

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (ejecutar tras aplicar)
-- ════════════════════════════════════════════════════════════════════════════
--   SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies WHERE schemaname='public'
--   ORDER BY tablename, cmd;
--
-- Smoke test recomendado (con un usuario participant real):
--   - debe PODER: ver partidos, apuntarse/desapuntarse a sí mismo.
--   - NO debe poder: crear/borrar partidos, borrar la plaza de otro usuario.
-- Con un admin: crear/editar/borrar partidos y gestionar participantes.
