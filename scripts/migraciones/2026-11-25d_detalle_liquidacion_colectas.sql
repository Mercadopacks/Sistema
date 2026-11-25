-- Pedido 2026-11-25 (4ta vuelta): el resumen por zonas/extras cuenta
-- "Colectas" a partir de fechas distintas de envios.fecha_colecta
-- (ver resumen_matriz_liquidacion_cliente(), rama "Colectas"), pero el
-- detalle de envíos (detalle_liquidacion_cliente()) nunca incluía esas
-- fechas — solo tenía 3 ramas: Envío/Turbo (desde envios) y Adicionales/
-- Descuentos (desde liquidacion_extras_clientes, que no tiene filas de
-- colecta). Resultado: el resumen mostraba "5 colectas" pero el detalle
-- no tenía ninguna fila que lo explicara. Se agrega una 4ta rama con las
-- fechas distintas de colecta del período, usando el mismo precio_colecta
-- de precios_cliente que ya usa el resumen.
drop function if exists public.detalle_liquidacion_cliente(bigint, date, date);
create or replace function public.detalle_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date
)
returns table (
  tipo text, fecha date, cuenta text, direccion text, localidad text, zona text, tamano text, monto numeric, id_venta text
)
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
  select 'Envío'::text, e.fecha_estado::date,
         coalesce(lc.ml_user, e.usuario_ml_id),
         ecd.direccion, e.localidad, co.nombre,
         case when e.tamano = 'Pequeño' then 'Pequeños' else 'Grandes' end,
         pce.precio,
         e.id_venta_ml
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
         ecd.direccion, e.localidad, co.nombre,
         case when e.tamano = 'Pequeño' then 'Pequeños' else 'Grandes' end,
         pc.precio_turbo_envio,
         e.id_venta_ml
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

  select 'Colecta', fc.fecha_colecta, null, null, null, null, null,
         v_precios.precio_colecta,
         null
  from (
    select distinct e.fecha_colecta::date as fecha_colecta
    from public.envios e
    where e.did_cliente = p_did_cliente
      and e.fecha_colecta is not null
      and e.fecha_colecta::date between p_fecha_inicio and p_fecha_fin
  ) fc

  union all

  select pte.nombre, le.fecha, null, le.direccion, null, null, null,
         case when pte.signo = 'descuento' then -le.importe else le.importe end,
         null
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente
    and le.fecha between p_fecha_inicio and p_fecha_fin

  order by 3, 2, 1;
end;
$$;
grant execute on function public.detalle_liquidacion_cliente(bigint, date, date) to authenticated;

notify pgrst, 'reload schema';
