-- Pedido 2026-11-26 (bug real reportado): "cómo calculaste los precios en
-- la vista consolidada? no tiene relación con los precios cargados en el
-- ABM de cuentas, tiene que estar detallado como la lógica de
-- liquidación, cada paquete cruzado por tamaño y zona y eso es lo que se
-- toma como referencia para la comparativa."
--
-- La versión anterior de generar_liquidacion_consolidada() inventaba una
-- "tarifa propia efectiva" dividiendo monto_a_pagar / paquetes de la
-- liquidación individual (un PROMEDIO implícito) — documentado como
-- simplificación a validar, y el usuario la rechazó con razón: dos
-- subcuentas con la misma cantidad total de paquetes pero distinta
-- MEZCLA de zonas/tamaños daban un promedio que no refleja ningún precio
-- real cargado en precios_cliente_envio.
--
-- Se corrige: la diferencia ahora se calcula CELDA A CELDA (zona ×
-- tamaño), igual que arma resumen_matriz_liquidacion_cliente() para
-- Liquidación Clientes/Mis Liquidaciones — se reusa esa misma función
-- (no se duplica la lógica de precios) tanto para la grilla de la
-- subcuenta como para la grilla de referencia de la PRINCIPAL. Por cada
-- celda con paquetes reales: diferencia_celda = (precio propio de la
-- subcuenta en esa celda - precio de la principal en esa misma celda) *
-- cantidad de la subcuenta en esa celda. La diferencia total de la
-- subcuenta es la suma de esas celdas — ya no hay una "tarifa de
-- referencia" única por cuenta (se guarda null), porque no existe tal
-- cosa cuando hay más de una zona/tamaño.
create or replace function public.generar_liquidacion_consolidada(
  p_did_principal bigint, p_fecha_inicio date, p_fecha_fin date
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id_consolidada bigint;
  v_liq_principal record;
  v_faltantes text;
  v_total_paquetes numeric := 0;
  v_total_diferencias numeric := 0;
  v_rec record;
  v_celda record;
  v_paquetes_principal numeric;
begin
  if not public.tiene_permiso_vista('admin') then
    raise exception 'No autorizado a generar liquidaciones consolidadas.';
  end if;

  select string_agg(lc.nombre_fantasia, ', ')
    into v_faltantes
  from public.clientes_relaciones cr
  join public.lightdata_clientes lc on lc.did = cr.did_subcuenta
  left join public.liquidaciones_clientes liq
    on liq.did_cliente = cr.did_subcuenta
    and liq.fecha_inicio = p_fecha_inicio and liq.fecha_fin = p_fecha_fin
    and liq.estado = 'generada'
  where cr.did_principal = p_did_principal and cr.activo and liq.id is null;

  if v_faltantes is not null then
    raise exception 'Faltan generar liquidaciones individuales de: %', v_faltantes;
  end if;

  select * into v_liq_principal
  from public.liquidaciones_clientes
  where did_cliente = p_did_principal and fecha_inicio = p_fecha_inicio and fecha_fin = p_fecha_fin
    and estado = 'generada';
  if v_liq_principal.id is null then
    raise exception 'Falta generar la liquidación individual de la cuenta principal para este período.';
  end if;

  v_paquetes_principal := coalesce(v_liq_principal.cantidad_envios, 0) + coalesce(v_liq_principal.cantidad_turbo, 0);
  v_total_paquetes := v_paquetes_principal;

  insert into public.liquidaciones_consolidadas (
    did_principal, fecha_inicio, fecha_fin, generado_por
  ) values (
    p_did_principal, p_fecha_inicio, p_fecha_fin, auth.uid()
  ) returning id into v_id_consolidada;

  insert into public.liquidaciones_consolidadas_detalle (
    liquidacion_consolidada_id, did_cliente, tipo, liquidacion_cliente_id,
    cantidad_paquetes, tarifa_propia, tarifa_referencia, importe_bruto, diferencia, saldo_consolidado
  ) values (
    v_id_consolidada, p_did_principal, 'principal', v_liq_principal.id,
    v_paquetes_principal, null, null, v_liq_principal.monto_a_pagar, 0, v_liq_principal.monto_a_pagar
  );

  -- Grilla de precios REALES de la cuenta PRINCIPAL por zona×tamaño
  -- (precios_cliente_envio, vía la misma función que arma sus propias
  -- tarjetas de resumen) — esto es "la referencia", nunca un promedio.
  create temporary table tmp_precios_principal on commit drop as
  select grupo, item, max(precio) as precio
  from public.resumen_matriz_liquidacion_cliente(p_did_principal, p_fecha_inicio, p_fecha_fin)
  where grupo <> 'Extras'
  group by grupo, item;

  for v_rec in
    select cr.did_subcuenta, liq.*
    from public.clientes_relaciones cr
    join public.liquidaciones_clientes liq
      on liq.did_cliente = cr.did_subcuenta
      and liq.fecha_inicio = p_fecha_inicio and liq.fecha_fin = p_fecha_fin
      and liq.estado = 'generada'
    where cr.did_principal = p_did_principal and cr.activo
  loop
    declare
      v_paquetes_subcuenta numeric := coalesce(v_rec.cantidad_envios, 0) + coalesce(v_rec.cantidad_turbo, 0);
      v_diferencia_subcuenta numeric := 0;
    begin
      -- "Cada paquete cruzado por tamaño y zona" (pedido explícito): se
      -- compara celda a celda contra la grilla real de la subcuenta
      -- (misma función que arma SUS propias tarjetas), no un promedio.
      -- Si la principal no tiene un precio configurado para alguna
      -- celda (precio_referencia null), esa celda queda sin comparar
      -- (no se inventa un 0 que exageraría la diferencia) — limitación
      -- documentada: pasa si la principal no cubre esa zona/tamaño.
      for v_celda in
        select m.grupo, m.item, m.cantidad, m.precio, tp.precio as precio_referencia
        from public.resumen_matriz_liquidacion_cliente(v_rec.did_subcuenta, p_fecha_inicio, p_fecha_fin) m
        left join tmp_precios_principal tp on tp.grupo = m.grupo and tp.item = m.item
        where m.grupo <> 'Extras' and coalesce(m.cantidad, 0) > 0
      loop
        if v_celda.precio_referencia is not null then
          v_diferencia_subcuenta := v_diferencia_subcuenta + (coalesce(v_celda.precio, 0) - v_celda.precio_referencia) * v_celda.cantidad;
        end if;
      end loop;

      v_total_paquetes := v_total_paquetes + v_paquetes_subcuenta;
      v_total_diferencias := v_total_diferencias + v_diferencia_subcuenta;

      insert into public.liquidaciones_consolidadas_detalle (
        liquidacion_consolidada_id, did_cliente, tipo, liquidacion_cliente_id,
        cantidad_paquetes, tarifa_propia, tarifa_referencia, importe_bruto, diferencia, saldo_consolidado
      ) values (
        v_id_consolidada, v_rec.did_subcuenta, 'subcuenta', v_rec.id,
        v_paquetes_subcuenta,
        -- Informativo nada más (promedio simple, ya NO se usa para
        -- calcular diferencia/saldo): no hay una única "tarifa propia"
        -- cuando hay más de una zona/tamaño en juego.
        case when v_paquetes_subcuenta > 0 then v_rec.monto_a_pagar / v_paquetes_subcuenta else null end,
        null, -- ya no existe una "tarifa de referencia" única — la comparación real es celda a celda (ver v_diferencia_subcuenta)
        v_rec.monto_a_pagar, v_diferencia_subcuenta, -v_diferencia_subcuenta
      );
    end;
  end loop;

  update public.liquidaciones_consolidadas
  set total_paquetes = v_total_paquetes,
      importe_bruto_principal = v_liq_principal.monto_a_pagar,
      total_diferencias = v_total_diferencias,
      monto_neto = (
        select coalesce(sum(saldo_consolidado), 0)
        from public.liquidaciones_consolidadas_detalle
        where liquidacion_consolidada_id = v_id_consolidada
      )
  where id = v_id_consolidada;

  return v_id_consolidada;
end;
$$;
grant execute on function public.generar_liquidacion_consolidada(bigint, date, date) to authenticated;

notify pgrst, 'reload schema';
