-- Pedido 2026-11-24 (tercera vuelta): Liquidación Clientes pasa de modal a
-- pantalla completa + la grilla necesita Cantidad de envíos/Monto estimado
-- SIN abrir cada cliente (para no hacer 1 RPC por fila).

-- 1) Resumen por cliente para la GRILLA (cantidad de envíos + monto
-- estimado, sin pallets — Depósito de Fulfillment se confirma recién al
-- liquidar, acá se puede estimar todo lo demás).
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
    join public.precios_cliente_envio pce
      on pce.precios_cliente_id = pc.id and pce.tamano_paquete_id = tp.id and pce.cordon_id = e.cordon_id
    where e.fecha_mercadopacks::date between p_fecha_inicio and p_fecha_fin
      and coalesce(e.origen, '') <> 'ML TURBO'
    group by e.did_cliente
  ),
  turbo as (
    select e.did_cliente, count(*) as cantidad
    from public.envios e
    join precios pc on pc.did_cliente = e.did_cliente
    where e.fecha_mercadopacks::date between p_fecha_inicio and p_fecha_fin
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

-- 2) Detalle itemizado: se agrega la columna "Cuenta" (Username de ML,
-- igual criterio que Clientes — ver fix 2026-11-2x de mostrar ml_user en
-- vez del ID) resuelta por envios.usuario_ml_id = lightdata_cuentas.ml_id_vendedor.
-- Cambia el shape de columnas devuelto (saca "referencia", agrega
-- "cuenta") — hay que dropear la función vieja, Postgres no permite
-- cambiar el return type de una función con solo CREATE OR REPLACE.
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
  select 'Envío'::text, e.fecha_mercadopacks::date,
         coalesce(lc.ml_user, e.usuario_ml_id),
         ecd.direccion, e.localidad, co.nombre, e.tamano, pce.precio
  from public.envios e
  join public.precios_cliente pc on pc.did_cliente = e.did_cliente and pc.activo
  join public.parametros_tamanos_paquete tp on tp.nombre = e.tamano
  join public.precios_cliente_envio pce
    on pce.precios_cliente_id = pc.id and pce.tamano_paquete_id = tp.id and pce.cordon_id = e.cordon_id
  left join public.envios_contacto_destinatario ecd on ecd.id_interno = e.id_interno
  left join public.parametros_cordones co on co.id = e.cordon_id
  left join public.lightdata_cuentas lc on lc.ml_id_vendedor = e.usuario_ml_id
  where e.did_cliente = p_did_cliente
    and e.fecha_mercadopacks::date between p_fecha_inicio and p_fecha_fin
    and coalesce(e.origen, '') <> 'ML TURBO'

  union all

  select 'Turbo', e.fecha_mercadopacks::date,
         coalesce(lc.ml_user, e.usuario_ml_id),
         ecd.direccion, e.localidad, co.nombre, e.tamano, pc.precio_turbo_envio
  from public.envios e
  join public.precios_cliente pc on pc.did_cliente = e.did_cliente and pc.activo
  left join public.envios_contacto_destinatario ecd on ecd.id_interno = e.id_interno
  left join public.parametros_cordones co on co.id = e.cordon_id
  left join public.lightdata_cuentas lc on lc.ml_id_vendedor = e.usuario_ml_id
  where e.did_cliente = p_did_cliente
    and e.fecha_mercadopacks::date between p_fecha_inicio and p_fecha_fin
    and e.origen = 'ML TURBO'

  union all

  select pte.nombre, le.fecha, null, le.direccion, null, null, null,
         case when pte.signo = 'descuento' then -le.importe else le.importe end
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente
    and le.fecha between p_fecha_inicio and p_fecha_fin

  order by 2, 1;
$$;
grant execute on function public.detalle_liquidacion_cliente(bigint, date, date) to authenticated;

notify pgrst, 'reload schema';
