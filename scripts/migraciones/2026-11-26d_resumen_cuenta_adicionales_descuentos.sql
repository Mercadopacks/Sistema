-- Pedido 2026-11-26 (seguimiento del "no coincide"): para terminar de
-- consolidar en UNA sola consulta el cálculo de Liquidación Clientes
-- (ver js/pantallas/liquidacion-clientes.js, totalesDesdeMatriz()), hace
-- falta que resumen_matriz_liquidacion_cliente() devuelva la CANTIDAD
-- real de registros de Adicionales/Descuentos (hoy siempre null) — antes
-- esa cantidad solo la calculaba calcular_totales_liquidacion_cliente()
-- (la consulta aparte que se está dejando de usar).
-- OJO (ya pasó 2 veces, ver 2026-11-25e y el fix en 2026-11-26): un
-- "create or replace function" pisa TODOS los atributos de la función,
-- no solo el cuerpo — la versión en producción de esta función tiene
-- "security definer" + el guard de abajo (puede_ver_envio_de_cliente)
-- desde 2026-11-26_fix_resumen_security_definer.sql. Si esta migración
-- alguna vez se vuelve a tocar, hay que mantener EXACTAMENTE esas 2 líneas.
create or replace function public.resumen_matriz_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date
)
returns table (grupo text, item text, cantidad numeric, precio numeric, monto numeric, orden integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_precios record;
begin
  if not public.puede_ver_envio_de_cliente(p_did_cliente) then
    raise exception 'No autorizado a ver la liquidación de este cliente.';
  end if;

  select * into v_precios from public.precios_cliente where did_cliente = p_did_cliente and activo limit 1;

  return query
  select co.nombre,
         case when tp.nombre = 'Pequeño' then 'Pequeños' else 'Grandes' end,
         sum(coalesce(cnt.cantidad, 0))::numeric,
         max(pce.precio),
         sum(coalesce(cnt.cantidad, 0) * pce.precio),
         co.orden * 10 + (case when tp.nombre = 'Pequeño' then 1 else 2 end)
  from public.precios_cliente_envio pce
  join public.parametros_cordones co on co.id = pce.cordon_id
  join public.parametros_tamanos_paquete tp on tp.id = pce.tamano_paquete_id
  left join lateral (
    select count(*) as cantidad
    from public.envios e
    where e.did_cliente = p_did_cliente
      and e.cordon_id = pce.cordon_id
      and e.tamano = tp.nombre
      and upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
      and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
      and coalesce(e.origen, '') <> 'ML TURBO'
  ) cnt on true
  where pce.precios_cliente_id = v_precios.id
  group by co.nombre, co.orden, (case when tp.nombre = 'Pequeño' then 'Pequeños' else 'Grandes' end), (case when tp.nombre = 'Pequeño' then 1 else 2 end)

  union all

  select 'Extras', 'Turbos',
         cnt.cantidad::numeric, v_precios.precio_turbo_envio, cnt.cantidad * coalesce(v_precios.precio_turbo_envio, 0),
         900
  from (
    select count(*) as cantidad from public.envios e
    where e.did_cliente = p_did_cliente
      and upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
      and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
      and e.origen = 'ML TURBO'
  ) cnt

  union all

  select 'Extras', 'Colectas',
         count(*)::numeric, null,
         coalesce(sum(case when pte.signo = 'descuento' then -le.importe else le.importe end), 0),
         901
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente and le.fecha between p_fecha_inicio and p_fecha_fin
    and pte.nombre = 'Colectas'

  union all

  select 'Extras', 'Adicionales', count(*)::numeric, null,
         coalesce(sum(le.importe) filter (where pte.signo = 'adicional'), 0),
         902
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente and le.fecha between p_fecha_inicio and p_fecha_fin
    and pte.signo = 'adicional' and pte.nombre <> 'Colectas'

  union all

  select 'Extras', 'Descuentos', count(*)::numeric, null,
         -coalesce(sum(le.importe) filter (where pte.signo = 'descuento'), 0),
         903
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente and le.fecha between p_fecha_inicio and p_fecha_fin
    and pte.signo = 'descuento' and pte.nombre <> 'Colectas'

  order by 6;
end;
$$;
grant execute on function public.resumen_matriz_liquidacion_cliente(bigint, date, date) to authenticated;

-- calcular_totales_liquidacion_cliente() queda sin ningún caller en el
-- código (js/pantallas/liquidacion-clientes.js y mis-liquidaciones.js ya
-- no la llaman, ver commits de esta misma vuelta) — era precisamente la
-- segunda fuente independiente que causaba el "no coincide" reportado.
-- Se elimina para que nadie la vuelva a usar sin querer y reintroduzca
-- el mismo bug de raíz.
drop function if exists public.calcular_totales_liquidacion_cliente(bigint, date, date, numeric);

notify pgrst, 'reload schema';
