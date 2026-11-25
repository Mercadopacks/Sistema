-- Pedido 2026-11-25: de cara al CLIENTE (ABM de precios y pantallas de
-- Liquidación Clientes) solo se maneja "Pequeños" y "Grandes" (Grandes
-- agrupa lo que hoy son los envíos Mediano Y Grande). Para Repartidores
-- (Picking Tamaños, Asistencia, Liquidación de Repartidores el día que se
-- arme) se sigue usando el tamaño real de 3 valores (envios.tamano,
-- parametros_tamanos_paquete) sin ningún cambio — no se toca esa tabla ni
-- la columna envios.tamano.
--
-- Decisión de diseño (mínimo cambio, sin tablas nuevas): el ABM de precios
-- por cliente (js/admin/clientes.js) pasa a mostrar 2 filas (Pequeños/
-- Grandes), pero la fila "Grandes" escribe el MISMO precio en las 2 filas
-- reales de precios_cliente_envio (Mediano y Grande) para ese cordón. Así
-- ningún otro cálculo necesita tocarse: calcular_totales_liquidacion_cliente
-- ya suma por el tamaño real de cada envío (join e.tamano = tp.nombre), y
-- como de ahora en más Mediano y Grande siempre van a tener el mismo
-- precio configurado, el total da exactamente igual sea cual sea el
-- tamaño real del envío entregado.
--
-- 1) Fix de datos único: unifica el precio de Mediano y Grande (por
--    cliente y cordón) al mayor de los dos, para que, a partir de ahora,
--    "Grandes" sea un valor único y consistente en los datos ya cargados.
with pares as (
  select
    pce_peq.precios_cliente_id,
    pce_peq.cordon_id,
    greatest(coalesce(pce_med.precio, 0), coalesce(pce_gra.precio, 0)) as precio_unificado
  from public.precios_cliente_envio pce_peq
  join public.parametros_tamanos_paquete tp_med on tp_med.nombre = 'Mediano'
  join public.parametros_tamanos_paquete tp_gra on tp_gra.nombre = 'Grande'
  left join public.precios_cliente_envio pce_med
    on pce_med.precios_cliente_id = pce_peq.precios_cliente_id
   and pce_med.cordon_id = pce_peq.cordon_id
   and pce_med.tamano_paquete_id = tp_med.id
  left join public.precios_cliente_envio pce_gra
    on pce_gra.precios_cliente_id = pce_peq.precios_cliente_id
   and pce_gra.cordon_id = pce_peq.cordon_id
   and pce_gra.tamano_paquete_id = tp_gra.id
  where pce_peq.tamano_paquete_id in (select id from public.parametros_tamanos_paquete where nombre in ('Mediano', 'Grande'))
  group by pce_peq.precios_cliente_id, pce_peq.cordon_id, pce_med.precio, pce_gra.precio
)
update public.precios_cliente_envio pce
set precio = pares.precio_unificado
from pares
join public.parametros_tamanos_paquete tp on tp.nombre in ('Mediano', 'Grande')
where pce.precios_cliente_id = pares.precios_cliente_id
  and pce.cordon_id = pares.cordon_id
  and pce.tamano_paquete_id = tp.id;

-- Completa la fila faltante donde un cliente tenía precio cargado para
-- Mediano pero no para Grande (o viceversa), para que de ahora en más
-- ambas filas existan siempre juntas.
insert into public.precios_cliente_envio (precios_cliente_id, tamano_paquete_id, cordon_id, precio)
select pce.precios_cliente_id, tp_falt.id, pce.cordon_id, pce.precio
from public.precios_cliente_envio pce
join public.parametros_tamanos_paquete tp_actual on tp_actual.id = pce.tamano_paquete_id and tp_actual.nombre in ('Mediano', 'Grande')
join public.parametros_tamanos_paquete tp_falt on tp_falt.nombre in ('Mediano', 'Grande') and tp_falt.id <> tp_actual.id
where not exists (
  select 1 from public.precios_cliente_envio pce2
  where pce2.precios_cliente_id = pce.precios_cliente_id
    and pce2.cordon_id = pce.cordon_id
    and pce2.tamano_paquete_id = tp_falt.id
)
on conflict (precios_cliente_id, tamano_paquete_id, cordon_id) do nothing;

-- 2) resumen_matriz_liquidacion_cliente(): agrupa Mediano+Grande en una
--    sola fila "Grandes" por cordón (cantidad sumada, precio = el mismo
--    para ambos tras el fix de datos de arriba, monto sumado).
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
  -- Matriz Cordón x Categoría de tamaño para el cliente (Pequeños/
  -- Grandes — Grandes agrupa Mediano+Grande reales) — SIEMPRE se listan
  -- todos los combos que tienen precio configurado para este cliente,
  -- aunque no haya envíos entregados ese período (cantidad 0).
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

-- 3) detalle_liquidacion_cliente(): la columna "tamano" que ve el cliente
--    pasa a mostrar "Pequeños"/"Grandes" en vez del tamaño real — el
--    cálculo del precio (pce.precio) sigue usando el tamaño real del
--    envío (e.tamano), eso no cambia.
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
$$;
grant execute on function public.detalle_liquidacion_cliente(bigint, date, date) to authenticated;

notify pgrst, 'reload schema';
