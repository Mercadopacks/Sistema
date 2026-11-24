-- Pedido 2026-11-23 (segunda vuelta): motor de cálculo de Liquidación
-- Clientes + reestructuración de Extras/Descuentos (Signo + Concepto,
-- compartido Cliente/Repartidor) + precio de Turbo.

-- 1) Precio fijo por envío "ML TURBO" (no varía por tamaño/cordón, mismo
-- criterio que la planilla vieja: una sola celda "totalTurbo").
alter table public.precios_cliente add column if not exists precio_turbo_envio numeric;

-- 2) Signo del tipo de extra/descuento (pedido: primero se elige
-- Adicional/Descuento, después el Concepto puntual dentro de ese signo).
alter table public.parametros_tipos_extra add column if not exists signo text;
update public.parametros_tipos_extra set signo = case when nombre ilike '%descuento%' then 'descuento' else 'adicional' end where signo is null;
alter table public.parametros_tipos_extra alter column signo set not null;
alter table public.parametros_tipos_extra alter column signo set default 'adicional';
alter table public.parametros_tipos_extra drop constraint if exists parametros_tipos_extra_signo_check;
alter table public.parametros_tipos_extra add constraint parametros_tipos_extra_signo_check check (signo in ('adicional', 'descuento'));

-- 3) Extras/Descuentos de Repartidores (mismo esquema que el de Clientes,
-- separado porque apunta a otra entidad — ver nota de diseño en
-- 2026-11-23e_liquidacion_extras.sql). El motor de Liquidación
-- Repartidores en sí todavía no se construye, pero la carga de extras ya
-- puede identificarse para uno u otro desde ya (pedido explícito).
create table if not exists public.liquidacion_extras_repartidores (
  id bigint generated always as identity primary key,
  fecha date not null,
  chofer_id bigint not null references public.choferes_roster(id),
  tipo_extra_id bigint not null references public.parametros_tipos_extra(id),
  envio_id_interno text references public.envios(id_interno),
  direccion text,
  importe numeric not null,
  observaciones text,
  creado_en timestamptz not null default now()
);
create index if not exists liquidacion_extras_repartidores_fecha_idx on public.liquidacion_extras_repartidores (fecha);
create index if not exists liquidacion_extras_repartidores_chofer_idx on public.liquidacion_extras_repartidores (chofer_id);

alter table public.liquidacion_extras_repartidores enable row level security;
drop policy if exists "liquidacion_extras_repartidores select" on public.liquidacion_extras_repartidores;
create policy "liquidacion_extras_repartidores select" on public.liquidacion_extras_repartidores for select to authenticated using (true);
drop policy if exists "liquidacion_extras_repartidores insert" on public.liquidacion_extras_repartidores;
create policy "liquidacion_extras_repartidores insert" on public.liquidacion_extras_repartidores for insert to authenticated with check (true);
drop policy if exists "liquidacion_extras_repartidores update" on public.liquidacion_extras_repartidores;
create policy "liquidacion_extras_repartidores update" on public.liquidacion_extras_repartidores for update to authenticated using (true) with check (true);
drop policy if exists "liquidacion_extras_repartidores delete" on public.liquidacion_extras_repartidores;
create policy "liquidacion_extras_repartidores delete" on public.liquidacion_extras_repartidores for delete to authenticated using (true);
grant select, insert, update, delete on public.liquidacion_extras_repartidores to authenticated;
grant all on public.liquidacion_extras_repartidores to service_role;

-- 4) Cabecera de liquidación de cliente — "borrador" mientras se completan
-- datos (ej. cantidad de pallets de Fulfillment), "generada" cuando se
-- confirma. Un período (did_cliente+fecha_inicio+fecha_fin) nunca se
-- liquida 2 veces.
create table if not exists public.liquidaciones_clientes (
  id bigint generated always as identity primary key,
  did_cliente bigint not null references public.lightdata_clientes(did),
  tipo_servicio text not null check (tipo_servicio in ('ultima_milla', 'fulfillment')),
  fecha_inicio date not null,
  fecha_fin date not null,
  estado text not null default 'borrador' check (estado in ('borrador', 'generada')),
  cantidad_pallets numeric,
  total_envios numeric not null default 0,
  cantidad_envios integer not null default 0,
  total_turbo numeric not null default 0,
  cantidad_turbo integer not null default 0,
  total_adicional numeric not null default 0,
  total_descuento numeric not null default 0,
  total_deposito numeric not null default 0,
  total_despacho numeric not null default 0,
  monto_a_pagar numeric not null default 0,
  creado_en timestamptz not null default now(),
  generado_en timestamptz,
  unique (did_cliente, fecha_inicio, fecha_fin)
);
create index if not exists liquidaciones_clientes_estado_idx on public.liquidaciones_clientes (estado);

alter table public.liquidaciones_clientes enable row level security;
drop policy if exists "liquidaciones_clientes select" on public.liquidaciones_clientes;
create policy "liquidaciones_clientes select" on public.liquidaciones_clientes for select to authenticated using (true);
drop policy if exists "liquidaciones_clientes insert" on public.liquidaciones_clientes;
create policy "liquidaciones_clientes insert" on public.liquidaciones_clientes for insert to authenticated with check (true);
drop policy if exists "liquidaciones_clientes update" on public.liquidaciones_clientes;
create policy "liquidaciones_clientes update" on public.liquidaciones_clientes for update to authenticated using (true) with check (true);
drop policy if exists "liquidaciones_clientes delete" on public.liquidaciones_clientes;
create policy "liquidaciones_clientes delete" on public.liquidaciones_clientes for delete to authenticated using (true);
grant select, insert, update, delete on public.liquidaciones_clientes to authenticated;
grant all on public.liquidaciones_clientes to service_role;

-- 5) Detecta períodos con envíos que todavía no tienen una liquidación
-- "generada" — semana (lunes a domingo) para Última Milla, mes calendario
-- para Fulfillment. Solo períodos ya CERRADOS (no el que está en curso).
create or replace function public.liquidaciones_pendientes_clientes()
returns jsonb
language sql
stable
as $$
  with periodos_um as (
    select e.did_cliente,
           date_trunc('week', e.fecha_mercadopacks::date)::date as fecha_inicio,
           (date_trunc('week', e.fecha_mercadopacks::date) + interval '6 days')::date as fecha_fin,
           'ultima_milla'::text as tipo_servicio
    from public.envios e
    join public.precios_cliente pc on pc.did_cliente = e.did_cliente and pc.activo and pc.tipo_servicio = 'ultima_milla'
    where e.did_cliente is not null
    group by 1, 2, 3
  ),
  periodos_ff as (
    select e.did_cliente,
           date_trunc('month', e.fecha_mercadopacks::date)::date as fecha_inicio,
           (date_trunc('month', e.fecha_mercadopacks::date) + interval '1 month - 1 day')::date as fecha_fin,
           'fulfillment'::text as tipo_servicio
    from public.envios e
    join public.precios_cliente pc on pc.did_cliente = e.did_cliente and pc.activo and pc.tipo_servicio = 'fulfillment'
    where e.did_cliente is not null
    group by 1, 2, 3
  ),
  todos as (
    select * from periodos_um
    union all
    select * from periodos_ff
  ),
  cerrados as (
    select * from todos
    where fecha_fin < (now() at time zone 'America/Argentina/Buenos_Aires')::date
  ),
  sin_liquidar as (
    select t.*
    from cerrados t
    where not exists (
      select 1 from public.liquidaciones_clientes lc
      where lc.did_cliente = t.did_cliente
        and lc.fecha_inicio = t.fecha_inicio
        and lc.fecha_fin = t.fecha_fin
        and lc.estado = 'generada'
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'did_cliente', sl.did_cliente,
    'cliente', coalesce(lc2.nombre_fantasia, lc2.codigo),
    'tipo_servicio', sl.tipo_servicio,
    'fecha_inicio', sl.fecha_inicio,
    'fecha_fin', sl.fecha_fin,
    'borrador_id', (
      select b.id from public.liquidaciones_clientes b
      where b.did_cliente = sl.did_cliente and b.fecha_inicio = sl.fecha_inicio and b.fecha_fin = sl.fecha_fin
        and b.estado = 'borrador'
      limit 1
    )
  ) order by sl.fecha_inicio desc), '[]'::jsonb)
  from sin_liquidar sl
  join public.lightdata_clientes lc2 on lc2.did = sl.did_cliente;
$$;
grant execute on function public.liquidaciones_pendientes_clientes() to authenticated;

-- 6) Calcula los totales de un período puntual para un cliente —
-- reusado tanto para previsualizar un borrador como para confirmarlo.
-- Envíos "pequeños"/"mediano_grande" por tamaño+cordón (matriz de
-- precios_cliente_envio); Turbo con precio fijo por envío; Adicional/
-- Descuento sumados desde liquidacion_extras_clientes según el signo de
-- su tipo; depósito/despacho solo si el cliente es Fulfillment.
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
  v_total_descuento numeric := 0;
  v_total_deposito numeric := 0;
  v_total_despacho numeric := 0;
begin
  select * into v_precios from public.precios_cliente where did_cliente = p_did_cliente and activo limit 1;

  select coalesce(sum(pce.precio), 0), count(*)
    into v_total_envios, v_cantidad_envios
  from public.envios e
  join public.parametros_tamanos_paquete tp on tp.nombre = e.tamano
  join public.precios_cliente_envio pce
    on pce.precios_cliente_id = v_precios.id
   and pce.tamano_paquete_id = tp.id
   and pce.cordon_id = e.cordon_id
  where e.did_cliente = p_did_cliente
    and e.fecha_mercadopacks::date between p_fecha_inicio and p_fecha_fin
    and coalesce(e.origen, '') <> 'ML TURBO';

  select count(*) into v_cantidad_turbo
  from public.envios e
  where e.did_cliente = p_did_cliente
    and e.fecha_mercadopacks::date between p_fecha_inicio and p_fecha_fin
    and e.origen = 'ML TURBO';
  v_total_turbo := v_cantidad_turbo * coalesce(v_precios.precio_turbo_envio, 0);

  select
    coalesce(sum(le.importe) filter (where pte.signo = 'adicional'), 0),
    coalesce(sum(le.importe) filter (where pte.signo = 'descuento'), 0)
    into v_total_adicional, v_total_descuento
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
    'total_descuento', v_total_descuento,
    'total_deposito', v_total_deposito,
    'total_despacho', v_total_despacho,
    'monto_a_pagar', v_total_envios + v_total_turbo + v_total_adicional - v_total_descuento + v_total_deposito + v_total_despacho
  );
end;
$$;
grant execute on function public.calcular_totales_liquidacion_cliente(bigint, date, date, numeric) to authenticated;

-- Semilla de ejemplo: "Fletes" como Adicional (se cargan en Extras, punto
-- 7 del pedido).
insert into public.parametros_tipos_extra (nombre, requiere_envio, aplica_a, signo)
values ('Fletes', false, 'cliente', 'adicional')
on conflict (nombre) do update set signo = excluded.signo;
update public.parametros_tipos_extra set signo = 'descuento' where nombre = 'Descuento por paquete perdido o extraviado';
update public.parametros_tipos_extra set signo = 'adicional' where nombre = 'Adicional por flete';

notify pgrst, 'reload schema';
