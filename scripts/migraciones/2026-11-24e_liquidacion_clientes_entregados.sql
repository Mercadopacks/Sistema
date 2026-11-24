-- Pedido 2026-11-24 (5ta vuelta): la liquidación de Clientes solo debe
-- tomar envíos EFECTIVAMENTE ENTREGADOS ("Entregado"/"Entregado 2DA
-- visita", casing real visto en la base), filtrando por su FECHA DE
-- ENTREGA (envios.fecha_estado, que es la fecha del último cambio de
-- estado — para un envío entregado, esa es la fecha de entrega) en vez de
-- fecha_mercadopacks (fecha de venta). También se agregan cantidades de
-- Adicional/Descuento (para el resumen tipo "Item/Cantidad/Monto" del
-- detalle) y se persisten en liquidaciones_clientes para no perder el
-- dato de una liquidación ya generada.

alter table public.liquidaciones_clientes add column if not exists cantidad_adicional integer not null default 0;
alter table public.liquidaciones_clientes add column if not exists cantidad_descuento integer not null default 0;

create or replace function public.resumen_liquidacion_clientes(
  p_tipo_servicio text, p_fecha_inicio date, p_fecha_fin date
)
returns table (did_cliente bigint, cantidad_envios integer, monto_estimado numeric)
language sql
stable
as $$
  with precios as (
    select * from public.precios_cliente where tipo_servicio = p_tipo_servicio and activo
  ),
  envios_normales as (
    select e.did_cliente, count(*) as cantidad, coalesce(sum(pce.precio), 0) as total
    from public.envios e
    join precios pc on pc.did_cliente = e.did_cliente
    join public.parametros_tamanos_paquete tp on tp.nombre = e.tamano
    left join public.precios_cliente_envio pce
      on pce.precios_cliente_id = pc.id and pce.tamano_paquete_id = tp.id and pce.cordon_id = e.cordon_id
    where upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
      and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
      and coalesce(e.origen, '') <> 'ML TURBO'
    group by e.did_cliente
  ),
  turbo as (
    select e.did_cliente, count(*) as cantidad
    from public.envios e
    join precios pc on pc.did_cliente = e.did_cliente
    where upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
      and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
      and e.origen = 'ML TURBO'
    group by e.did_cliente
  ),
  extras as (
    select le.did_cliente,
      coalesce(sum(le.importe) filter (where pte.signo = 'adicional'), 0) as adicional,
      coalesce(sum(le.importe) filter (where pte.signo = 'descuento'), 0) as descuento
    from public.liquidacion_extras_clientes le
    join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
    where le.fecha between p_fecha_inicio and p_fecha_fin
    group by le.did_cliente
  )
  select
    pc.did_cliente,
    (coalesce(en.cantidad, 0) + coalesce(tb.cantidad, 0))::int as cantidad_envios,
    coalesce(en.total, 0)
      + coalesce(tb.cantidad, 0) * coalesce(pc.precio_turbo_envio, 0)
      + coalesce(ex.adicional, 0) - coalesce(ex.descuento, 0)
      + case when pc.tipo_servicio = 'fulfillment'
             then (coalesce(en.cantidad, 0) + coalesce(tb.cantidad, 0)) * coalesce(pc.precio_despacho_envio, 0)
             else 0 end
      as monto_estimado
  from precios pc
  left join envios_normales en on en.did_cliente = pc.did_cliente
  left join turbo tb on tb.did_cliente = pc.did_cliente
  left join extras ex on ex.did_cliente = pc.did_cliente;
$$;
grant execute on function public.resumen_liquidacion_clientes(text, date, date) to authenticated;

create or replace function public.calcular_totales_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date, p_cantidad_pallets numeric default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_precios record;
  v_total_envios numeric := 0;
  v_cantidad_envios integer := 0;
  v_cantidad_turbo integer := 0;
  v_total_turbo numeric := 0;
  v_total_adicional numeric := 0;
  v_cantidad_adicional integer := 0;
  v_total_descuento numeric := 0;
  v_cantidad_descuento integer := 0;
  v_total_deposito numeric := 0;
  v_total_despacho numeric := 0;
begin
  select * into v_precios from public.precios_cliente where did_cliente = p_did_cliente and activo limit 1;

  select coalesce(sum(pce.precio), 0), count(*)
    into v_total_envios, v_cantidad_envios
  from public.envios e
  join public.parametros_tamanos_paquete tp on tp.nombre = e.tamano
  left join public.precios_cliente_envio pce
    on pce.precios_cliente_id = v_precios.id
   and pce.tamano_paquete_id = tp.id
   and pce.cordon_id = e.cordon_id
  where e.did_cliente = p_did_cliente
    and upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
    and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
    and coalesce(e.origen, '') <> 'ML TURBO';

  select count(*) into v_cantidad_turbo
  from public.envios e
  where e.did_cliente = p_did_cliente
    and upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
    and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
    and e.origen = 'ML TURBO';
  v_total_turbo := v_cantidad_turbo * coalesce(v_precios.precio_turbo_envio, 0);

  select
    coalesce(sum(le.importe) filter (where pte.signo = 'adicional'), 0),
    count(*) filter (where pte.signo = 'adicional'),
    coalesce(sum(le.importe) filter (where pte.signo = 'descuento'), 0),
    count(*) filter (where pte.signo = 'descuento')
    into v_total_adicional, v_cantidad_adicional, v_total_descuento, v_cantidad_descuento
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente
    and le.fecha between p_fecha_inicio and p_fecha_fin;

  if v_precios.tipo_servicio = 'fulfillment' then
    v_total_despacho := (v_cantidad_envios + v_cantidad_turbo) * coalesce(v_precios.precio_despacho_envio, 0);
    v_total_deposito := coalesce(p_cantidad_pallets, 0) * coalesce(v_precios.precio_deposito_pallet, 0);
  end if;

  return jsonb_build_object(
    'total_envios', v_total_envios,
    'cantidad_envios', v_cantidad_envios,
    'total_turbo', v_total_turbo,
    'cantidad_turbo', v_cantidad_turbo,
    'total_adicional', v_total_adicional,
    'cantidad_adicional', v_cantidad_adicional,
    'total_descuento', v_total_descuento,
    'cantidad_descuento', v_cantidad_descuento,
    'total_deposito', v_total_deposito,
    'total_despacho', v_total_despacho,
    'monto_a_pagar', v_total_envios + v_total_turbo + v_total_adicional - v_total_descuento + v_total_deposito + v_total_despacho
  );
end;
$$;
grant execute on function public.calcular_totales_liquidacion_cliente(bigint, date, date, numeric) to authenticated;

drop function if exists public.detalle_liquidacion_cliente(bigint, date, date);
create or replace function public.detalle_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date
)
returns table (
  tipo text, fecha date, cuenta text, direccion text, localidad text, zona text, tamano text, monto numeric
)
language sql
stable
as $$
  select 'Envío'::text, e.fecha_estado::date,
         coalesce(lc.ml_user, e.usuario_ml_id),
         ecd.direccion, e.localidad, co.nombre, e.tamano, pce.precio
  from public.envios e
  join public.precios_cliente pc on pc.did_cliente = e.did_cliente and pc.activo
  join public.parametros_tamanos_paquete tp on tp.nombre = e.tamano
  left join public.precios_cliente_envio pce
    on pce.precios_cliente_id = pc.id and pce.tamano_paquete_id = tp.id and pce.cordon_id = e.cordon_id
  left join public.envios_contacto_destinatario ecd on ecd.id_interno = e.id_interno
  left join public.parametros_cordones co on co.id = e.cordon_id
  left join public.lightdata_cuentas lc on lc.ml_id_vendedor = e.usuario_ml_id
  where e.did_cliente = p_did_cliente
    and upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
    and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
    and coalesce(e.origen, '') <> 'ML TURBO'

  union all

  select 'Turbo', e.fecha_estado::date,
         coalesce(lc.ml_user, e.usuario_ml_id),
         ecd.direccion, e.localidad, co.nombre, e.tamano, pc.precio_turbo_envio
  from public.envios e
  join public.precios_cliente pc on pc.did_cliente = e.did_cliente and pc.activo
  left join public.envios_contacto_destinatario ecd on ecd.id_interno = e.id_interno
  left join public.parametros_cordones co on co.id = e.cordon_id
  left join public.lightdata_cuentas lc on lc.ml_id_vendedor = e.usuario_ml_id
  where e.did_cliente = p_did_cliente
    and upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
    and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
    and e.origen = 'ML TURBO'

  union all

  select pte.nombre, le.fecha, null, le.direccion, null, null, null,
         case when pte.signo = 'descuento' then -le.importe else le.importe end
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente
    and le.fecha between p_fecha_inicio and p_fecha_fin

  order by 3, 2, 1;
$$;
grant execute on function public.detalle_liquidacion_cliente(bigint, date, date) to authenticated;

notify pgrst, 'reload schema';
