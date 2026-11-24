-- Pedido 2026-11-24: la Dirección no debe mostrarse para CUALQUIER
-- concepto que no pida envío (ej. "Adelanto" de un repartidor no es ni
-- envío ni dirección) — solo para los conceptos de tipo Flete. Se separa
-- en su propio flag, independiente de requiere_envio.
alter table public.parametros_tipos_extra add column if not exists requiere_direccion boolean not null default false;
update public.parametros_tipos_extra set requiere_direccion = true where nombre ilike '%flete%';

notify pgrst, 'reload schema';
