-- Fix real: la migración 2026-11-20c creó las tablas de "Precios por
-- Cliente" con sus policies de RLS pero sin los GRANT de Postgres
-- correspondientes (grant select/all a authenticated/service_role) — en
-- Supabase, sin el GRANT la policy de RLS ni se evalúa, Postgres rechaza
-- el acceso un paso antes ("permission denied for table ..."). Mismo
-- patrón que lightdata_clientes/parametros_sectores/lightdata_cuentas
-- (ver 2026-11-20_tipo_usuario_y_acceso_por_cliente.sql y
-- 2026-11-20b_lightdata_cuentas.sql), que sí lo tenían. Idempotente.

grant select on public.parametros_tamanos_paquete to authenticated;
grant insert, update, delete on public.parametros_tamanos_paquete to authenticated;
grant all on public.parametros_tamanos_paquete to service_role;

grant select on public.parametros_cordones to authenticated;
grant insert, update, delete on public.parametros_cordones to authenticated;
grant all on public.parametros_cordones to service_role;

grant select, insert, update, delete on public.precios_cliente to authenticated;
grant all on public.precios_cliente to service_role;

grant select, insert, update, delete on public.precios_cliente_envio to authenticated;
grant all on public.precios_cliente_envio to service_role;

grant select, insert, update, delete on public.precios_cliente_flete to authenticated;
grant all on public.precios_cliente_flete to service_role;

-- La columna nueva zona_id/cordon_id de parametros_localidades no necesita
-- grant aparte (la tabla entera ya lo tenía desde antes de esta feature).

notify pgrst, 'reload schema';
