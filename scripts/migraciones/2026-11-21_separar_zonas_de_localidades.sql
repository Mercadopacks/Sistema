-- Revertir la unificación Zona/Localidad del 20/11 (pedido explícito del
-- usuario, ver reglas_de_negocio.md changelog 2026-11-21): la Zona vuelve
-- a ser su propio ABM parametrizable (parametros_zonas, que nunca se
-- había borrado), y cada localidad se asocia a ella por FK en vez de
-- texto libre. CP y Cordón de la localidad quedan igual que el 20/11.
-- Idempotente. No hay datos que migrar: nadie llegó a cargar zona/cp/
-- cordón en producción todavía (confirmado antes de escribir esto).

alter table public.parametros_localidades
  add column if not exists zona_id bigint references public.parametros_zonas(id);

alter table public.parametros_localidades
  drop column if exists zona;

comment on table public.parametros_zonas is null;

notify pgrst, 'reload schema';
