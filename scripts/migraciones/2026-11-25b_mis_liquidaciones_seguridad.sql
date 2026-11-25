-- Pedido 2026-11-25: nueva sección "Mis Liquidaciones" para que un
-- usuario tipo_usuario='cliente' vea, de solo lectura, lo mismo que ve un
-- administrativo en Liquidación Clientes pero acotado a su(s) propio(s)
-- did_cliente (perfiles_usuario.clientes_lightdata_ids).
--
-- Problema real: resumen_matriz_liquidacion_cliente, detalle_liquidacion_
-- cliente y calcular_totales_liquidacion_cliente son funciones INVOKER
-- (no definer) que hacen join directo contra precios_cliente/
-- precios_cliente_envio/precios_cliente_flete — tablas con RLS
-- "for all using (tiene_permiso_vista('admin'))", sin excepción para el
-- propio cliente (2026-11-20c_precios_por_cliente.sql:111-127, regla de
-- negocio explícita: "ningún cliente ve el tarifario de otros"). Si un
-- cliente las llamara tal cual, el RLS le devuelve 0 filas de
-- precios_cliente (sin error) y todo sale en NULL/0 — inútiles para él.
--
-- Decisión confirmada con el usuario: el cliente SÍ puede ver el precio
-- unitario de SU PROPIA liquidación (no es "el tarifario de otros", es su
-- propio precio). Se resuelve con el patrón ya usado en
-- puede_ver_envio_de_cliente(): las 3 funciones pasan a SECURITY DEFINER
-- (corren con los privilegios del dueño, bypasean el RLS de precios_
-- cliente*) + un guard explícito al inicio que exige
-- puede_ver_envio_de_cliente(p_did_cliente) — un cliente solo puede
-- pedir datos de SU propio did (o de ninguno, si no está vinculado);
-- un administrativo sigue teniendo acceso a cualquier did, como hasta
-- ahora (la función ya contempla ese caso: "admin o tipo_usuario<>cliente
-- => true").

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
         cnt.cantidad::numeric, v_precios.precio_colecta, cnt.cantidad * coalesce(v_precios.precio_colecta, 0),
         901
  from (
    select count(distinct e.fecha_colecta::date) as cantidad from public.envios e
    where e.did_cliente = p_did_cliente
      and e.fecha_colecta is not null
      and e.fecha_colecta::date between p_fecha_inicio and p_fecha_fin
  ) cnt

  union all

  select 'Extras', 'Adicionales', null, null,
         coalesce(sum(le.importe) filter (where pte.signo = 'adicional'), 0),
         902
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente and le.fecha between p_fecha_inicio and p_fecha_fin
    and pte.signo = 'adicional'

  union all

  select 'Extras', 'Descuentos', null, null,
         -coalesce(sum(le.importe) filter (where pte.signo = 'descuento'), 0),
         903
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente and le.fecha between p_fecha_inicio and p_fecha_fin
    and pte.signo = 'descuento'

  order by 6;
end;
$$;
grant execute on function public.resumen_matriz_liquidacion_cliente(bigint, date, date) to authenticated;

drop function if exists public.detalle_liquidacion_cliente(bigint, date, date);
create or replace function public.detalle_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date
)
returns table (
  tipo text, fecha date, cuenta text, direccion text, localidad text, zona text, tamano text, monto numeric
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
         pce.precio
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
         pc.precio_turbo_envio
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
end;
$$;
grant execute on function public.detalle_liquidacion_cliente(bigint, date, date) to authenticated;

create or replace function public.calcular_totales_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date, p_cantidad_pallets numeric default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
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
  if not public.puede_ver_envio_de_cliente(p_did_cliente) then
    raise exception 'No autorizado a ver la liquidación de este cliente.';
  end if;

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
    'precio_despacho_configurado', v_precios.precio_despacho_envio,
    'precio_deposito_configurado', v_precios.precio_deposito_pallet,
    'monto_a_pagar', v_total_envios + v_total_turbo + v_total_adicional - v_total_descuento + v_total_deposito + v_total_despacho
  );
end;
$$;
grant execute on function public.calcular_totales_liquidacion_cliente(bigint, date, date, numeric) to authenticated;

-- Nueva: hace falta saber si el cliente es "ultima_milla" (período =
-- semana) o "fulfillment" (período = mes) para armar el selector de
-- período en "Mis Liquidaciones" — ese dato vive en precios_cliente,
-- bloqueado por RLS para el propio cliente, igual que los precios.
create or replace function public.tipo_servicio_cliente(p_did_cliente bigint)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo text;
begin
  if not public.puede_ver_envio_de_cliente(p_did_cliente) then
    raise exception 'No autorizado.';
  end if;
  select tipo_servicio into v_tipo from public.precios_cliente where did_cliente = p_did_cliente and activo limit 1;
  return v_tipo;
end;
$$;
grant execute on function public.tipo_servicio_cliente(bigint) to authenticated;

notify pgrst, 'reload schema';
