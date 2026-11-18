-- Fix: fallidos_seguimiento nunca tuvo GRANT para service_role (mismo bug
-- que ya se había dado con perfiles_usuario — RLS y GRANT son capas
-- separadas, service_role bypassea RLS pero igual necesita el GRANT).
-- Lo necesita, por ejemplo, un borrado administrativo de envíos viejos
-- hecho con la service role key (ver reglas_de_negocio.md, changelog).
grant select, insert, update, delete on public.fallidos_seguimiento to service_role;

-- Mismo bug, mismas tablas del mismo módulo: tampoco tenían GRANT para
-- service_role (hacía falta para medir tiempos de consulta con la service
-- role key desde un script, ver changelog 2026-11-18).
grant select, insert, update, delete on public.parametros_fallidos_mapeo to service_role;
grant select, update on public.parametros_alertas_fallidos to service_role;
