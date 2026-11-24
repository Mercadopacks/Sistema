-- Pedido 2026-11-24 (6ta vuelta):
-- 1) Índices que faltaban en `envios` para el filtro por cliente+estado+
--    fecha de entrega que usa todo el motor de Liquidación Clientes — no
--    había NINGÚN índice por did_cliente, así que cada cálculo hacía un
--    seq scan completo de la tabla (34.000 filas) por cada cliente.
-- 2) `precio_colecta` en precios_cliente (la columna "COLECTA" del Excel
--    de precios que se había dejado sin migrar por "semántica no clara"
--    — ahora se confirma que es el precio por visita de colecta).
-- 3) resumen_matriz_liquidacion_cliente(): el desglose Grupo (Cordón) x
--    Tamaño/Item con Cantidad/Precio/Monto que se muestra en la pantalla
--    de detalle (reemplaza la tabla simple "Item/Cantidad/Monto").
-- 4) 2 columnas nuevas en liquidaciones_clientes para los precios de
--    Fulfillment editables POR LIQUIDACIÓN (Almacenamiento/Despacho
--    Unitario varían mes a mes, no toman el precio fijo del cliente).

create index if not exists envios_did_cliente_idx on public.envios (did_cliente);
create index if not exists envios_did_cliente_estado_fecha_idx on public.envios (did_cliente, estado, fecha_estado);

alter table public.precios_cliente add column if not exists precio_colecta numeric;

alter table public.liquidaciones_clientes add column if not exists precio_despacho_periodo numeric;
alter table public.liquidaciones_clientes add column if not exists precio_deposito_periodo numeric;

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
  -- Matriz Cordón x Tamaño — SIEMPRE se listan todos los combos que
  -- tienen precio configurado para este cliente, aunque no haya envíos
  -- entregados ese período (cantidad 0), igual que la liquidación de
  -- referencia.
  select co.nombre, tp.nombre,
         coalesce(cnt.cantidad, 0)::numeric,
         pce.precio,
         coalesce(cnt.cantidad, 0) * pce.precio,
         co.orden * 10 + tp.orden
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

  -- Colectas: cantidad de visitas de colecta distintas (por fecha)
  -- registradas en los envíos del cliente en el período.
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

-- calcular_totales_liquidacion_cliente ahora también informa los precios
-- CONFIGURADOS de Depósito/Despacho (sin aplicar ningún override) — el
-- front los usa como valor por default de los inputs editables de
-- Almacenamiento/Despacho Unitario (pedido 2026-11-24: esos precios
-- varían cada liquidación, el cliente solo trae un valor de referencia).
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
    'precio_despacho_configurado', v_precios.precio_despacho_envio,
    'precio_deposito_configurado', v_precios.precio_deposito_pallet,
    'monto_a_pagar', v_total_envios + v_total_turbo + v_total_adicional - v_total_descuento + v_total_deposito + v_total_despacho
  );
end;
$$;
grant execute on function public.calcular_totales_liquidacion_cliente(bigint, date, date, numeric) to authenticated;

notify pgrst, 'reload schema';
