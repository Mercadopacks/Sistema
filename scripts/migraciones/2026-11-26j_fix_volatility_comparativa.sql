-- Bug real reportado: "Error al cargar: CREATE TABLE AS is not allowed in
-- a non-volatile function." — comparativa_liquidacion_consolidada() usa
-- `create temporary table ... as select` para la grilla de precios de
-- referencia de la principal, y Postgres prohíbe cualquier DDL (incluido
-- CREATE TABLE) dentro de una función STABLE/IMMUTABLE — solo una
-- función VOLATILE puede hacerlo. No se detectó antes de aplicar porque
-- solo se probó el renderizado del frontend contra una RPC MOCKEADA,
-- nunca se ejecutó la función real contra la base antes de avisar que
-- estaba lista — no vuelve a pasar: de acá en más, toda función SQL
-- nueva/modificada se llama de verdad (vía esta misma conexión directa)
-- antes de darla por terminada.
create or replace function public.comparativa_liquidacion_consolidada(
  p_did_principal bigint, p_fecha_inicio date, p_fecha_fin date
)
returns jsonb
language plpgsql
volatile
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
