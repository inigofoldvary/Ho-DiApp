-- =====================================================================
-- HO-DIAPP · Arreglo de permisos de lectura (v1.1)
-- Pegar en Supabase > SQL Editor > New query > Run.
-- Da permiso a los usuarios con sesión para LEER las tablas.
-- Qué filas ve cada uno lo siguen decidiendo las reglas (RLS) de 01.
-- =====================================================================
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
alter default privileges in schema public grant select on tables to authenticated;
