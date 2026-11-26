-- Liquidación Consolidada — ajustes pedidos por el usuario después de
-- probar la 1ra vuelta:
--   1) La vinculación cuenta principal <-> subcuenta pasa a administrarse
--      desde Configuración (nuevo ABM, admin-only) — la pantalla de
--      Liquidación Consolidada en sí va a poder verla más adelante la
--      propia cuenta principal, que no debe poder tocar sus propios
--      vínculos. Esto es un cambio de UI (ver js/pantallas/liquidacion-
--      consolidada.js e index.html), acá solo el ajuste de esquema.
--   2) La tarifa de referencia deja de ser un valor pactado a mano por
--      subcuenta: siempre es la tarifa PROPIA de la cuenta principal
--      (misma fórmula "efectiva" ya usada para la tarifa propia de cada
--      subcuenta: monto_a_pagar / paquetes de su liquidación individual
--      ya generada). Se saca clientes_relaciones.tarifa_referencia.
--   3) La diferencia SIEMPRE se resta del saldo de la cuenta principal —
--      se saca el "signo configurable" (clientes_relaciones.signo_ajuste
--      y liquidaciones_consolidadas_detalle.signo_ajuste): no hace falta
--      una condición, el resultado ya sale "a favor" o "en contra" solo
--      por el signo de la propia diferencia (tarifa propia de la
--      subcuenta vs. tarifa de la principal).

alter table public.clientes_relaciones
  drop column if exists tarifa_referencia,
  drop column if exists signo_ajuste;

alter table public.liquidaciones_consolidadas_detalle
  drop column if exists signo_ajuste;

-- subcuentas_para_consolidar(): ya no devuelve tarifa_referencia/
-- signo_ajuste (esas columnas no existen más en clientes_relaciones).
drop function if exists public.subcuentas_para_consolidar(bigint, date, date);
create or replace function public.subcuentas_para_consolidar(
  p_did_principal bigint, p_fecha_inicio date, p_fecha_fin date
)
returns table (
  did_subcuenta bigint, nombre_fantasia text,
  liquidacion_cliente_id bigint, liquidacion_estado text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.puede_ver_envio_de_cliente(p_did_principal) then
    raise exception 'No autorizado a ver las subcuentas de este cliente.';
  end if;

  return query
  select cr.did_subcuenta, lc.nombre_fantasia, liq.id, liq.estado
  from public.clientes_relaciones cr
  join public.lightdata_clientes lc on lc.did = cr.did_subcuenta
  left join public.liquidaciones_clientes liq
    on liq.did_cliente = cr.did_subcuenta
    and liq.fecha_inicio = p_fecha_inicio and liq.fecha_fin = p_fecha_fin
  where cr.did_principal = p_did_principal and cr.activo
  order by lc.nombre_fantasia;
end;
$$;
grant execute on function public.subcuentas_para_consolidar(bigint, date, date) to authenticated;

-- generar_liquidacion_consolidada(): la tarifa de referencia ya no sale
-- de clientes_relaciones (pactada a mano) — se calcula de la propia
-- liquidación de la cuenta PRINCIPAL, igual que la tarifa propia de cada
-- subcuenta. La diferencia siempre resta (saldo_consolidado = -diferencia
-- para cada subcuenta, sin condición de signo).
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
  v_diferencia numeric;
  v_paquetes_principal numeric;
  v_tarifa_referencia numeric;
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
  v_tarifa_referencia := case when v_paquetes_principal > 0 then v_liq_principal.monto_a_pagar / v_paquetes_principal else null end;
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
    v_paquetes_principal, v_tarifa_referencia, v_tarifa_referencia, v_liq_principal.monto_a_pagar, 0, v_liq_principal.monto_a_pagar
  );

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
      v_tarifa_propia numeric := case when coalesce(v_rec.cantidad_envios, 0) + coalesce(v_rec.cantidad_turbo, 0) > 0
        then v_rec.monto_a_pagar / (coalesce(v_rec.cantidad_envios, 0) + coalesce(v_rec.cantidad_turbo, 0))
        else null end;
    begin
      v_diferencia := coalesce(v_tarifa_propia - v_tarifa_referencia, 0) * v_paquetes_subcuenta;
      v_total_paquetes := v_total_paquetes + v_paquetes_subcuenta;
      v_total_diferencias := v_total_diferencias + v_diferencia;

      insert into public.liquidaciones_consolidadas_detalle (
        liquidacion_consolidada_id, did_cliente, tipo, liquidacion_cliente_id,
        cantidad_paquetes, tarifa_propia, tarifa_referencia, importe_bruto, diferencia, saldo_consolidado
      ) values (
        v_id_consolidada, v_rec.did_subcuenta, 'subcuenta', v_rec.id,
        v_paquetes_subcuenta, v_tarifa_propia, v_tarifa_referencia, v_rec.monto_a_pagar,
        v_diferencia, -v_diferencia
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

-- obtener_liquidacion_consolidada(): el jsonb de detalle ya no trae
-- signo_ajuste (no existe más).
create or replace function public.obtener_liquidacion_consolidada(p_id bigint)
returns table (
  id bigint, did_principal bigint, fecha_inicio date, fecha_fin date, estado text,
  total_paquetes numeric, importe_bruto_principal numeric, total_diferencias numeric, monto_neto numeric,
  detalle jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lc record;
begin
  select * into v_lc from public.liquidaciones_consolidadas where liquidaciones_consolidadas.id = p_id;
  if v_lc.id is null or not public.puede_ver_envio_de_cliente(v_lc.did_principal) then
    raise exception 'No autorizado o liquidación consolidada inexistente.';
  end if;

  return query
  select v_lc.id, v_lc.did_principal, v_lc.fecha_inicio, v_lc.fecha_fin, v_lc.estado,
         v_lc.total_paquetes, v_lc.importe_bruto_principal, v_lc.total_diferencias, v_lc.monto_neto,
         (
           select jsonb_agg(jsonb_build_object(
             'did_cliente', d.did_cliente, 'nombre_fantasia', lcli.nombre_fantasia, 'tipo', d.tipo,
             'cantidad_paquetes', d.cantidad_paquetes, 'tarifa_propia', d.tarifa_propia,
             'tarifa_referencia', d.tarifa_referencia, 'importe_bruto', d.importe_bruto,
             'diferencia', d.diferencia, 'saldo_consolidado', d.saldo_consolidado
           ) order by d.tipo desc, lcli.nombre_fantasia)
           from public.liquidaciones_consolidadas_detalle d
           join public.lightdata_clientes lcli on lcli.did = d.did_cliente
           where d.liquidacion_consolidada_id = v_lc.id
         );
end;
$$;
grant execute on function public.obtener_liquidacion_consolidada(bigint) to authenticated;

notify pgrst, 'reload schema';
