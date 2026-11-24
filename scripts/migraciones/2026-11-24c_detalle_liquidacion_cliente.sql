-- Pedido 2026-11-24: vista de detalle/edición de la liquidación con el
-- listado itemizado de cada envío + extra a cobrar en el período (estilo
-- la liquidación de repartidor que pasó el usuario como referencia:
-- Nro/Tipo/Fecha/Dirección/Localidad/Zona/Tamaño/Monto).
create or replace function public.detalle_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date
)
returns table (
  tipo text, fecha date, referencia text, direccion text, localidad text, zona text, tamano text, monto numeric
)
language sql
stable
as $$
  select 'Envío'::text, e.fecha_mercadopacks::date, coalesce(e.tracking, e.id_venta_ml),
         ecd.direccion, e.localidad, co.nombre, e.tamano, pce.precio
  from public.envios e
  join public.precios_cliente pc on pc.did_cliente = e.did_cliente and pc.activo
  join public.parametros_tamanos_paquete tp on tp.nombre = e.tamano
  join public.precios_cliente_envio pce
    on pce.precios_cliente_id = pc.id and pce.tamano_paquete_id = tp.id and pce.cordon_id = e.cordon_id
  left join public.envios_contacto_destinatario ecd on ecd.id_interno = e.id_interno
  left join public.parametros_cordones co on co.id = e.cordon_id
  where e.did_cliente = p_did_cliente
    and e.fecha_mercadopacks::date between p_fecha_inicio and p_fecha_fin
    and coalesce(e.origen, '') <> 'ML TURBO'

  union all

  select 'Turbo', e.fecha_mercadopacks::date, coalesce(e.tracking, e.id_venta_ml),
         ecd.direccion, e.localidad, co.nombre, e.tamano, pc.precio_turbo_envio
  from public.envios e
  join public.precios_cliente pc on pc.did_cliente = e.did_cliente and pc.activo
  left join public.envios_contacto_destinatario ecd on ecd.id_interno = e.id_interno
  left join public.parametros_cordones co on co.id = e.cordon_id
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
