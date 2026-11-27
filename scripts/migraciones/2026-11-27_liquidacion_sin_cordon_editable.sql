-- Bug real 2026-11-27: en Liquidación Clientes, el Detalle de abajo no
-- coincidía con el Resumen/Total de arriba. Causa: detalle_liquidacion_
-- cliente() arranca desde `envios` (cualquier envío entregado del
-- período entra), pero resumen_matriz_liquidacion_cliente() arranca desde
-- `precios_cliente_envio` (la tabla de precios por cordón) -- un envío sin
-- cordon_id no tiene con qué cruzar y desaparecía en silencio del resumen,
-- del "Total envíos" y del "Monto total a pagar", aunque siguiera en el
-- detalle. Confirmado contra producción: 111 envíos entregados (Mix
-- Store/Diaz Home/Núcleo, 17-26 nov) sin localidad NI cp -- hueco de datos
-- real y puntual de Lightdata (~1.4% de los envíos ML de ese período, no
-- un bug sistemático de ingesta), que ni siquiera llega a encolarse para
-- clasificar a mano en Configuración > Localidades (esa cola requiere un
-- CP real, ver fn_resolver_cordon_envio en 2026-11-23_mapeo_localidad_
-- cordon.sql).
--
-- Fix de fondo: resumen_matriz_liquidacion_cliente() pasa a arrancar
-- desde `envios` (igual que detalle_liquidacion_cliente), con LEFT JOIN a
-- parametros_cordones/precios_cliente_envio -- un envío sin cordón cae en
-- un grupo nuevo "Sin cordón asignar" con precio null, que el aviso de
-- tarifa $0,00 que YA EXISTE en el frontend (calcularAvisoTarifaCero, js/
-- ui/liquidacion-vista.js) detecta solo con esto, sin tocar ese JS.
--
-- Además se agrega la corrección manual pedida: detalle_liquidacion_
-- cliente() ahora expone id_interno (necesario para identificar la fila a
-- corregir -- antes no viajaba) y una RPC nueva, corregir_cordon_tamano_
-- envio(), para que un admin/administrativo pueda arreglar el cordón o el
-- tamaño de un envío puntual desde la propia pantalla de Liquidación
-- Clientes mientras el período siga pendiente/borrador (ver js/pantallas/
-- liquidacion-clientes.js). envios sigue de solo lectura para el
-- navegador salvo por esta vía controlada -- mismo criterio ya
-- documentado en 2026-11-23b_grants_columnas_envios_triggers.sql ("nadie
-- debería poder reescribir un envío entero desde el navegador"). El
-- trigger trg_resolver_cordon_envio solo dispara con cambios de
-- localidad/cp, así que este UPDATE directo de cordon_id no se pisa solo.

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
  select coalesce(co.nombre, 'Sin cordón asignar'),
         case when e.tamano = 'Pequeño' then 'Pequeños' else 'Grandes' end,
         count(*)::numeric,
         max(pce.precio),
         sum(coalesce(pce.precio, 0)),
         coalesce(co.orden, 99) * 10 + (case when e.tamano = 'Pequeño' then 1 else 2 end)
  from public.envios e
  left join public.parametros_cordones co on co.id = e.cordon_id
  left join public.parametros_tamanos_paquete tp on tp.nombre = e.tamano
  left join public.precios_cliente_envio pce
    on pce.precios_cliente_id = v_precios.id and pce.tamano_paquete_id = tp.id and pce.cordon_id = e.cordon_id
  where e.did_cliente = p_did_cliente
    and upper(e.estado) in ('ENTREGADO', 'ENTREGADO 2DA VISITA')
    and e.fecha_estado::date between p_fecha_inicio and p_fecha_fin
    and coalesce(e.origen, '') <> 'ML TURBO'
  group by coalesce(co.nombre, 'Sin cordón asignar'), coalesce(co.orden, 99),
           (case when e.tamano = 'Pequeño' then 'Pequeños' else 'Grandes' end),
           (case when e.tamano = 'Pequeño' then 1 else 2 end)

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

-- Agrega id_interno (identifica la fila a corregir) y tamano_real (el
-- Pequeño/Mediano/Grande crudo de envios.tamano, NO el bucket Pequeños/
-- Grandes de la columna "tamano" que ya se mostraba -- esa se deja igual
-- para no cambiar lo que ya se ve en pantalla; tamano_real es solo para
-- precargar el valor actual en el modal de corrección del frontend).
-- Cambia la firma de returns table -> hace falta dropear antes del
-- create or replace, mismo patrón que 2026-11-25e.
drop function if exists public.detalle_liquidacion_cliente(bigint, date, date);
create or replace function public.detalle_liquidacion_cliente(
  p_did_cliente bigint, p_fecha_inicio date, p_fecha_fin date
)
returns table (
  tipo text, fecha date, cuenta text, direccion text, localidad text, zona text, tamano text, monto numeric, id_venta text, id_interno text, tamano_real text
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
         e.id_venta_ml, e.id_interno, e.tamano
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
         e.id_venta_ml, e.id_interno, e.tamano
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
         null, null, null
  from public.liquidacion_extras_clientes le
  join public.parametros_tipos_extra pte on pte.id = le.tipo_extra_id
  where le.did_cliente = p_did_cliente
    and le.fecha between p_fecha_inicio and p_fecha_fin

  order by 3, 2, 1;
end;
$$;
grant execute on function public.detalle_liquidacion_cliente(bigint, date, date) to authenticated;

-- Corrección manual de Cordón/Tamaño de un envío puntual, pedida por el
-- usuario (2026-11-27): desde Liquidación Clientes, con el período en
-- pendiente/borrador (nunca con la liquidación ya "generada" -- eso lo
-- valida el frontend ocultando la acción, ver js/pantallas/liquidacion-
-- clientes.js). RPC en vez de UPDATE directo vía PostgREST a propósito:
-- `envios` sigue de solo lectura para el navegador, esta es la única
-- puerta de escritura controlada. coalesce(...) en el UPDATE: un valor
-- null en cualquiera de los 2 parámetros deja esa columna como estaba
-- (no hay forma de "desasignar" cordón/tamaño por esta vía, no hace
-- falta para el caso de uso -- siempre se corrige A un valor válido).
create or replace function public.corregir_cordon_tamano_envio(
  p_id_interno text, p_cordon_id bigint, p_tamano text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Mismo criterio de autorización que puede_ver_envio_de_cliente(): admin
  -- o cualquier tipo_usuario distinto de "cliente" (administrativo/
  -- repartidor); sin perfil todavía, fail-open (igual que el resto del
  -- sistema, ver sesion.js).
  if not coalesce((
    select p.es_admin or p.tipo_usuario <> 'cliente'
    from public.perfiles_usuario p where p.auth_user_id = auth.uid()
  ), true) then
    raise exception 'No autorizado a corregir envíos.';
  end if;

  if p_tamano is not null and not exists (select 1 from public.parametros_tamanos_paquete where nombre = p_tamano) then
    raise exception 'Tamaño inválido: %', p_tamano;
  end if;
  if p_cordon_id is not null and not exists (select 1 from public.parametros_cordones where id = p_cordon_id) then
    raise exception 'Cordón inválido: %', p_cordon_id;
  end if;

  update public.envios
  set cordon_id = coalesce(p_cordon_id, cordon_id),
      tamano = coalesce(p_tamano, tamano)
  where id_interno = p_id_interno;

  if not found then
    raise exception 'No se encontró el envío a corregir.';
  end if;
end;
$$;
grant execute on function public.corregir_cordon_tamano_envio(text, bigint, text) to authenticated;

notify pgrst, 'reload schema';
