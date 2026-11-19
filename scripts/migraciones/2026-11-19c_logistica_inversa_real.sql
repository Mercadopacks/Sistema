-- Fix de fondo del falso positivo "Logistica Inversa = No cuenta como
-- Cambio" (ver changelog 2026-11-19 anterior, que fue un parche sobre
-- texto libre). Lightdata SÍ tiene un flag real y confiable para esto
-- (confirmado contra el endpoint de envíos: filtros.logisticaInversa
-- 0=No/1=Sí/2=Todos, con cantidadRegistros exactos: 58003+953=58956) —
-- simplemente no lo expone como columna en la respuesta, solo como
-- filtro. `scripts/vincular_choferes_envios.py` ahora hace una segunda
-- consulta filtrada por día para completarlo acá.

alter table public.envios
  add column if not exists logistica_inversa_real boolean;

create index if not exists envios_logistica_inversa_real_idx
  on public.envios (logistica_inversa_real) where logistica_inversa_real = true;

create or replace function public.actualizar_logistica_inversa_lote(ids text[], valores boolean[])
returns void
language sql
as $$
  update public.envios e
  set logistica_inversa_real = v.valor
  from unnest(ids, valores) as v(id_interno, valor)
  where e.id_interno = v.id_interno;
$$;

revoke execute on function public.actualizar_logistica_inversa_lote(text[], boolean[]) from public, anon, authenticated;
grant execute on function public.actualizar_logistica_inversa_lote(text[], boolean[]) to service_role;
