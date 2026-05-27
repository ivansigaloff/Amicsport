-- ROLLBACK / RESTORE PRIOR RLS STATE - generated 2026-05-27
-- WARNING: recreates the PREVIOUS (insecure) policies. Emergency use only.
-- Run AFTER dropping the consolidated policies if you need to revert.

CREATE POLICY "Only admins can manage the player directory v2" ON public.admin_players AS PERMISSIVE FOR ALL TO public USING ((auth_role() IS DISTINCT FROM 'participant'::text)) WITH CHECK ((auth_role() IS DISTINCT FROM 'participant'::text));
CREATE POLICY admin_players_prod_admin_policy ON public.admin_players AS PERMISSIVE FOR ALL TO public USING (((auth_role() <> 'participant'::text) AND (auth_is_dev() IS NOT TRUE)));
CREATE POLICY strict_players_isolation ON public.admin_players AS PERMISSIVE FOR ALL TO public USING ((auth_is_dev() IS NOT TRUE));
CREATE POLICY admin_players_dev_all ON public.admin_players_dev AS PERMISSIVE FOR ALL TO public USING ((auth_is_admin() OR auth_is_dev()));
CREATE POLICY admin_players_dev_strict_policy ON public.admin_players_dev AS PERMISSIVE FOR ALL TO public USING (((auth_role() <> 'participant'::text) AND (auth_is_dev() = true)));
CREATE POLICY settings_admin_select ON public.app_settings AS PERMISSIVE FOR SELECT TO public USING (auth_is_admin());
CREATE POLICY settings_admin_update ON public.app_settings AS PERMISSIVE FOR UPDATE TO public USING (auth_is_admin());
CREATE POLICY audit_log_admin_select ON public.audit_log AS PERMISSIVE FOR SELECT TO public USING (auth_is_admin());
CREATE POLICY "Users can remove themselves or admins can manage all v2" ON public.match_participants AS PERMISSIVE FOR ALL TO public USING (((auth.uid() = user_id) OR (auth_role() IS DISTINCT FROM 'participant'::text)));
CREATE POLICY participants_isolation_policy ON public.match_participants AS PERMISSIVE FOR ALL TO public USING (((auth_is_dev() IS NOT TRUE) AND (auth_is_read() IS NOT TRUE)));
CREATE POLICY participants_prod_strict_policy ON public.match_participants AS PERMISSIVE FOR ALL TO public USING ((auth_is_dev() IS NOT TRUE));
CREATE POLICY strict_participants_isolation ON public.match_participants AS PERMISSIVE FOR ALL TO public USING ((auth_is_dev() IS NOT TRUE));
CREATE POLICY "Usuarios se dan de baja" ON public.match_participants AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Authenticated users can join matches" ON public.match_participants AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Permitir inscripcion de agenda" ON public.match_participants AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Usuarios se apuntan" ON public.match_participants AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Cualquiera ve participantes" ON public.match_participants AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Participants are viewable by everyone" ON public.match_participants AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY match_participants_dev_all ON public.match_participants_dev AS PERMISSIVE FOR ALL TO public USING ((auth_is_admin() OR auth_is_dev() OR (auth.uid() = user_id)));
CREATE POLICY participants_dev_strict_policy ON public.match_participants_dev AS PERMISSIVE FOR ALL TO public USING ((auth_is_dev() = true));
CREATE POLICY match_participants_dev_insert ON public.match_participants_dev AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY match_participants_dev_insert_auth ON public.match_participants_dev AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY match_participants_dev_select ON public.match_participants_dev AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY match_participants_dev_select_all ON public.match_participants_dev AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Admins can manage matches v2" ON public.matches AS PERMISSIVE FOR ALL TO public USING ((auth_role() IS DISTINCT FROM 'participant'::text)) WITH CHECK ((auth_role() IS DISTINCT FROM 'participant'::text));
CREATE POLICY matches_prod_admin_policy ON public.matches AS PERMISSIVE FOR ALL TO public USING (((auth_role() <> 'participant'::text) AND (auth_is_dev() IS NOT TRUE)));
CREATE POLICY strict_production_isolation ON public.matches AS PERMISSIVE FOR ALL TO public USING ((auth_is_dev() IS NOT TRUE));
CREATE POLICY "Admins (cualquier usuario) puede crear partidos" ON public.matches AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "Matches are viewable by everyone" ON public.matches AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Todos pueden ver partidos" ON public.matches AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Permitir todo en matches_dev" ON public.matches_dev AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY matches_dev_admin_all ON public.matches_dev AS PERMISSIVE FOR ALL TO public USING ((auth_is_admin() OR auth_is_dev()));
CREATE POLICY matches_dev_strict_policy ON public.matches_dev AS PERMISSIVE FOR ALL TO public USING (((auth_role() <> 'participant'::text) AND (auth_is_dev() = true)));
CREATE POLICY matches_dev_select ON public.matches_dev AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY matches_dev_select_all ON public.matches_dev AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY payments_user_select ON public.payments AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR auth_is_admin()));
CREATE POLICY "Permitir inserción y actualización global" ON public.saved_locations AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY strict_locations_isolation ON public.saved_locations AS PERMISSIVE FOR ALL TO public USING ((auth_is_dev() IS NOT TRUE));
CREATE POLICY "Permitir lectura global" ON public.saved_locations AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY saved_locations_dev_all ON public.saved_locations_dev AS PERMISSIVE FOR ALL TO public USING ((auth_is_admin() OR auth_is_dev()));
