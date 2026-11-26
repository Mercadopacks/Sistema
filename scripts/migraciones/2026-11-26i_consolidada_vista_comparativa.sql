-- Liquidación Consolidada — rediseño completo (pedido 2026-11-26, 4ta
-- vuelta): deja de ser algo que se "genera/anula/marca pagada" — pasa a
-- ser una VISTA DE COMPARACIÓN EN VIVO, sin ningún registro propio. El
-- objetivo es verificar el monto final que debe abonar la cuenta
-- principal, comparando celda a celda (zona × tamaño) su propia tarifa
-- contra la de cada subcuenta — la diferencia se resta SIEMPRE del lado
-- de la principal, la subcuenta nunca ve modificado lo que paga.
--
-- Se elimina por completo el modelo anterior (tablas + funciones de
-- generar/anular/marcar pagada) — nunca se llegó a generar una
-- consolidada real todavía, no hay nada que migrar.
drop function if exists public.generar_liquidacion_consolidada(bigint, date, date);
drop function if exists public.anular_liquidacion_consolidada(bigint);
drop function if exists public.marcar_pagada_liquidacion_consolidada(bigint);
drop function if exists public.obtener_liquidacion_consolidada(bigint);
drop function if exists public.subcuentas_para_consolidar(bigint, date, date);
drop table if exists public.liquidaciones_consolidadas_detalle;
drop table if exists public.liquidaciones_consolidadas;

-- Única función nueva: arma TODA la comparativa de un golpe (cuenta
-- principal + cada subcuenta activa), calculando en vivo contra
-- resumen_matriz_liquidacion_cliente() — la misma función que ya arma
-- las tarjetas de Liquidación Clientes/Mis Liquidaciones, para no
-- duplicar la lógica de precios real (ABM de Precios por Cliente).
--
-- Depende de que la liquidación INDIVIDUAL de cada cuenta ya esté
-- generada para el período (decisión confirmada con el usuario): si a
-- una cuenta le falta, queda marcada "pendiente" en el resultado y no
-- entra en el cálculo del monto final — no bloquea ver el resto.
create or replace function public.comparativa_liquidacion_consolidada(
  p_did_principal bigint, p_fecha_inicio date, p_fecha_fin date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_liq_principal record;
  v_filas_principal jsonb;
  v_subcuentas jsonb := '[]'::jsonb;
  v_total_diferencias numeric := 0;
  v_rec record;
  v_filas_sub jsonb;
  v_diferencia_sub numeric;
begin
  if not public.puede_ver_envio_de_cliente(p_did_principal) then
    raise exception 'No autorizado a ver la liquidación de este cliente.';
  end if;

  select * into v_liq_principal
  from public.liquidaciones_clientes
  where did_cliente = p_did_principal and fecha_inicio = p_fecha_inicio and fecha_fin = p_fecha_fin
    and estado = 'generada';

  select coalesce(jsonb_agg(jsonb_build_object(
           'zona', grupo, 'tamano', item, 'cantidad', cantidad, 'precio', precio, 'total', monto
         ) order by orden), '[]'::jsonb)
    into v_filas_principal
  from public.resumen_matriz_liquidacion_cliente(p_did_principal, p_fecha_inicio, p_fecha_fin)
  where grupo <> 'Extras';

  -- Grilla de precios REALES de la principal por zona×tamaño — "la
  -- referencia" (pedido explícito: nunca un promedio).
  create temporary table tmp_precio_principal on commit drop as
  select grupo, item, max(precio) as precio
  from public.resumen_matriz_liquidacion_cliente(p_did_principal, p_fecha_inicio, p_fecha_fin)
  where grupo <> 'Extras'
  group by grupo, item;

  for v_rec in
    select cr.did_subcuenta, lc.nombre_fantasia, liq.id as liq_id, liq.monto_a_pagar
    from public.clientes_relaciones cr
    join public.lightdata_clientes lc on lc.did = cr.did_subcuenta
    left join public.liquidaciones_clientes liq
      on liq.did_cliente = cr.did_subcuenta
      and liq.fecha_inicio = p_fecha_inicio and liq.fecha_fin = p_fecha_fin
      and liq.estado = 'generada'
    where cr.did_principal = p_did_principal and cr.activo
    order by lc.nombre_fantasia
  loop
    if v_rec.liq_id is null then
      v_subcuentas := v_subcuentas || jsonb_build_object(
        'did', v_rec.did_subcuenta, 'nombre_fantasia', v_rec.nombre_fantasia, 'estado', 'pendiente',
        'monto_a_pagar', null, 'filas', '[]'::jsonb, 'diferencia_total', null
      );
      continue;
    end if;

    -- Celda a celda (zona × tamaño): diferencia = (precio propio de la
    -- subcuenta - precio de la principal en esa misma celda) * cantidad
    -- de la subcuenta — solo en celdas con paquetes reales. Sin precio
    -- de referencia (la principal no tiene esa zona/tamaño configurado),
    -- la celda queda sin comparar (diferencia null), no se inventa un 0.
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'zona', m.grupo, 'tamano', m.item, 'cantidad', m.cantidad, 'precio', m.precio, 'total', m.monto,
        'precio_referencia', tp.precio,
        'diferencia', case when tp.precio is not null then (coalesce(m.precio, 0) - tp.precio) * m.cantidad else null end
      ) order by m.orden), '[]'::jsonb),
      coalesce(sum(case when tp.precio is not null then (coalesce(m.precio, 0) - tp.precio) * m.cantidad else 0 end), 0)
      into v_filas_sub, v_diferencia_sub
    from public.resumen_matriz_liquidacion_cliente(v_rec.did_subcuenta, p_fecha_inicio, p_fecha_fin) m
    left join tmp_precio_principal tp on tp.grupo = m.grupo and tp.item = m.item
    where m.grupo <> 'Extras' and coalesce(m.cantidad, 0) > 0;

    v_total_diferencias := v_total_diferencias + v_diferencia_sub;
    v_subcuentas := v_subcuentas || jsonb_build_object(
      'did', v_rec.did_subcuenta, 'nombre_fantasia', v_rec.nombre_fantasia, 'estado', 'generada',
      'monto_a_pagar', v_rec.monto_a_pagar, 'filas', v_filas_sub, 'diferencia_total', v_diferencia_sub
    );
  end loop;

  return jsonb_build_object(
    'principal', jsonb_build_object(
      'did', p_did_principal,
      'estado', case when v_liq_principal.id is null then 'pendiente' else 'generada' end,
      'monto_a_pagar', v_liq_principal.monto_a_pagar,
      'filas', v_filas_principal
    ),
    'subcuentas', v_subcuentas,
    'total_diferencias', v_total_diferencias,
    'monto_final_principal', case when v_liq_principal.id is null then null else v_liq_principal.monto_a_pagar - v_total_diferencias end
  );
end;
$$;
grant execute on function public.comparativa_liquidacion_consolidada(bigint, date, date) to authenticated;

notify pgrst, 'reload schema';
