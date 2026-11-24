-- Pedido 2026-11-23: sección "Extras y Descuentos" de Liquidación
-- Clientes — puerto estructurado de lo que en la planilla vieja era una
-- lista de texto suelta (rangoDetalleDescuentos, S6:S32 de
-- "Generar liquidacion.txt") a filas propias, para poder filtrar/sumar por
-- cliente y período.
--
-- Nombrada "liquidacion_extras_clientes" (no "liquidacion_extras" a
-- secas) a propósito: el usuario confirmó que más adelante va a hacer
-- falta algo similar para Liquidación Repartidores. Se decidió NO
-- mezclarlas en una sola tabla genérica (evita una asociación polimórfica
-- — una columna "tipo de entidad" + "id genérico" sin FK real a quien
-- corresponda, que rompe la integridad referencial) — el día que se
-- construya el lado de repartidores, va a ser su propia tabla
-- "liquidacion_extras_repartidores" con FK a choferes_roster. El catálogo
-- de Tipos sí queda compartido (ver columna aplica_a).

create table if not exists public.parametros_tipos_extra (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  -- Controla qué campo pide el modal de carga: con envío busca por
  -- tracking/ID de venta (ej. "Descuento por paquete perdido/extraviado");
  -- sin envío pide Dirección en su lugar (ej. "Adicional por flete").
  requiere_envio boolean not null default false,
  -- Catálogo compartido entre Liquidación Clientes y (a futuro)
  -- Liquidación Repartidores — filtra qué tipos ofrece cada pantalla.
  aplica_a text not null default 'cliente' check (aplica_a in ('cliente', 'repartidor', 'ambos')),
  activo boolean not null default true
);

create table if not exists public.liquidacion_extras_clientes (
  id bigint generated always as identity primary key,
  fecha date not null,
  did_cliente bigint not null references public.lightdata_clientes(did),
  tipo_extra_id bigint not null references public.parametros_tipos_extra(id),
  envio_id_interno text references public.envios(id_interno),
  direccion text,
  importe numeric not null,
  observaciones text,
  creado_en timestamptz not null default now()
);

create index if not exists liquidacion_extras_clientes_fecha_idx on public.liquidacion_extras_clientes (fecha);
create index if not exists liquidacion_extras_clientes_cliente_idx on public.liquidacion_extras_clientes (did_cliente);

alter table public.parametros_tipos_extra enable row level security;
drop policy if exists "parametros_tipos_extra select" on public.parametros_tipos_extra;
create policy "parametros_tipos_extra select" on public.parametros_tipos_extra for select to authenticated using (true);
drop policy if exists "parametros_tipos_extra insert" on public.parametros_tipos_extra;
create policy "parametros_tipos_extra insert" on public.parametros_tipos_extra for insert to authenticated with check (true);
drop policy if exists "parametros_tipos_extra update" on public.parametros_tipos_extra;
create policy "parametros_tipos_extra update" on public.parametros_tipos_extra for update to authenticated using (true) with check (true);
drop policy if exists "parametros_tipos_extra delete" on public.parametros_tipos_extra;
create policy "parametros_tipos_extra delete" on public.parametros_tipos_extra for delete to authenticated using (true);

alter table public.liquidacion_extras_clientes enable row level security;
drop policy if exists "liquidacion_extras_clientes select" on public.liquidacion_extras_clientes;
create policy "liquidacion_extras_clientes select" on public.liquidacion_extras_clientes for select to authenticated using (true);
drop policy if exists "liquidacion_extras_clientes insert" on public.liquidacion_extras_clientes;
create policy "liquidacion_extras_clientes insert" on public.liquidacion_extras_clientes for insert to authenticated with check (true);
drop policy if exists "liquidacion_extras_clientes update" on public.liquidacion_extras_clientes;
create policy "liquidacion_extras_clientes update" on public.liquidacion_extras_clientes for update to authenticated using (true) with check (true);
drop policy if exists "liquidacion_extras_clientes delete" on public.liquidacion_extras_clientes;
create policy "liquidacion_extras_clientes delete" on public.liquidacion_extras_clientes for delete to authenticated using (true);

grant select, insert, update, delete on public.parametros_tipos_extra to authenticated;
grant all on public.parametros_tipos_extra to service_role;
grant select, insert, update, delete on public.liquidacion_extras_clientes to authenticated;
grant all on public.liquidacion_extras_clientes to service_role;

-- Semilla con los 2 ejemplos ya conocidos.
insert into public.parametros_tipos_extra (nombre, requiere_envio, aplica_a)
values
  ('Descuento por paquete perdido o extraviado', true, 'cliente'),
  ('Adicional por flete', false, 'cliente')
on conflict (nombre) do nothing;

notify pgrst, 'reload schema';
