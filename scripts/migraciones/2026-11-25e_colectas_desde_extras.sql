-- Pedido 2026-11-25 (5ta vuelta): "las colectas se agregan directamente en
-- adicionales, no se tienen que tomar desde ninguna fecha" — el cálculo
-- anterior (fechas distintas de envios.fecha_colecta, migración
-- 2026-11-25_tamanos_cliente_pequeno_grande.sql) está MAL: las colectas
-- se cargan a mano como un ítem más de liquidacion_extras_clientes
-- (mismo mecanismo que Adicionales/Descuentos), con su propio tipo de
-- extra "Colectas" en parametros_tipos_extra. Se corrige:
--   1) resumen_matriz_liquidacion_cliente(): la fila "Colectas" pasa a
--      salir de liquidacion_extras_clientes (igual que Adicionales/
--      Descuentos), y se excluye explícitamente de esos 2 buckets para
--      no contarla dos veces.
--   2) detalle_liquidacion_cliente(): se saca la rama de "Colecta" por
--      fecha que se había agregado en la migración 2026-11-25d (estaba
--      mal) — las colectas ya aparecen solas en el detalle a través de la
--      rama genérica de extras (misma que Adicionales/Descuentos), sin
--      necesitar una rama aparte.

create or replace function public.resumen_matriz_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date
)
returns table (grupo text, item text, cantidad numeric, precio numeric, monto numeric, orden integer)
language plpgsql
stable
as $$
declare
  v_precios record;
begin
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

  -- Colectas: ítem cargado a mano en liquidacion_extras_clientes (igual
  -- que Adicionales/Descuentos), nunca calculado a partir de fechas de
  -- envíos.
  select 'Extras', 'Colectas',
         count(*)::numeric, null,
         coalesce(sum(case when pte.signo = 'descuento' then -le.importe else le.importe end), 0),
         901
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente and le.fecha between p_fecha_inicio and p_fecha_fin
    and pte.nombre = 'Colectas'

  union all

  select 'Extras', 'Adicionales', null, null,
         coalesce(sum(le.importe) filter (where pte.signo = 'adicional'), 0),
         902
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente and le.fecha between p_fecha_inicio and p_fecha_fin
    and pte.signo = 'adicional' and pte.nombre <> 'Colectas'

  union all

  select 'Extras', 'Descuentos', null, null,
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

-- Revierte detalle_liquidacion_cliente() a la versión sin la rama de
-- "Colecta" por fecha (quedaba mal: las colectas ya salen solas vía la
-- rama genérica de extras, con tipo = 'Colectas').
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
begin
  if not public.puede_ver_envio_de_cliente(p_did_cliente) then
    raise exception 'No autorizado a ver la liquidación de este cliente.';
  end if;

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
