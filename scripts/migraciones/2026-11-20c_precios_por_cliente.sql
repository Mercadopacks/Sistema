-- Precios por cliente — ver reglas_de_negocio.md changelog 2026-11-20
-- para el resumen. Idempotente (if not exists / or replace / drop if exists).

-- =====================================================================
-- 1. ABM de tamaños de paquete (Pequeño / Mediano / Grande, configurable).
-- =====================================================================
create table if not exists public.parametros_tamanos_paquete (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  orden integer not null default 0,
  activo boolean not null default true
);

insert into public.parametros_tamanos_paquete (nombre, orden)
values ('Pequeño', 1), ('Mediano', 2), ('Grande', 3)
on conflict (nombre) do nothing;

-- =====================================================================
-- 2. ABM de cordones (CABA / GBA1 / GBA2 / GBA3, configurable).
-- =====================================================================
create table if not exists public.parametros_cordones (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  orden integer not null default 0,
  activo boolean not null default true
);

insert into public.parametros_cordones (nombre, orden)
values ('CABA', 1), ('GBA1', 2), ('GBA2', 3), ('GBA3', 4)
on conflict (nombre) do nothing;

-- =====================================================================
-- 3. Unificación Zona + Localidad: hasta ahora `parametros_zonas` y
--    `parametros_localidades` eran dos ABMs independientes sin vínculo
--    entre sí. Pasan a vivir en una sola tabla: Zona, Localidad, CP y
--    Cordón (el cordón se elige de parametros_cordones). No se borra
--    `parametros_zonas` (sigue existiendo por compatibilidad con datos
--    viejos) pero deja de tener ABM propio en el frontend: la pantalla
--    de "Zonas" pasa a ser esta tabla unificada.
-- =====================================================================
alter table public.parametros_localidades
  add column if not exists zona text,
  add column if not exists cp text,
  add column if not exists cordon_id bigint references public.parametros_cordones(id);

comment on table public.parametros_zonas is
  'Deprecada: reemplazada por parametros_localidades.zona (unificación Zona/Localidad/CP/Cordón, 2026-11-20). Se conserva solo por compatibilidad histórica, no tiene ABM propio.';

-- =====================================================================
-- 4. Precios por cliente: cabecera (tipo de servicio + cargos fijos de
--    fulfillment) y dos matrices (envíos por tamaño×cordón, flete por
--    cordón). Los cargos de depósito/despacho son el PRECIO UNITARIO
--    (por pallet / por envío); la cantidad se calcula en la liquidación,
--    no acá.
-- =====================================================================
create table if not exists public.precios_cliente (
  id bigint generated always as identity primary key,
  did_cliente bigint not null unique references public.lightdata_clientes(did) on delete cascade,
  tipo_servicio text not null default 'ultima_milla' check (tipo_servicio in ('ultima_milla', 'fulfillment')),
  precio_deposito_pallet numeric(12, 2),
  precio_despacho_envio numeric(12, 2),
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.precios_cliente_envio (
  id bigint generated always as identity primary key,
  precios_cliente_id bigint not null references public.precios_cliente(id) on delete cascade,
  tamano_paquete_id bigint not null references public.parametros_tamanos_paquete(id),
  cordon_id bigint not null references public.parametros_cordones(id),
  precio numeric(12, 2) not null default 0,
  unique (precios_cliente_id, tamano_paquete_id, cordon_id)
);

create table if not exists public.precios_cliente_flete (
  id bigint generated always as identity primary key,
  precios_cliente_id bigint not null references public.precios_cliente(id) on delete cascade,
  cordon_id bigint not null references public.parametros_cordones(id),
  precio numeric(12, 2) not null default 0,
  unique (precios_cliente_id, cordon_id)
);

-- =====================================================================
-- 5. RLS: mismo patrón que el resto de "Configuración" (vista "admin"
--    gobierna la escritura), lectura abierta a cualquier autenticado
--    para los ABMs de tamaños/cordones (los necesitan los combos de
--    otras pantallas), pero los PRECIOS son información comercial
--    sensible: solo administrativos los leen y escriben (ningún
--    cliente, aunque tenga acceso al sistema, puede ver el tarifario).
-- =====================================================================
alter table public.parametros_tamanos_paquete enable row level security;
alter table public.parametros_cordones enable row level security;
alter table public.precios_cliente enable row level security;
alter table public.precios_cliente_envio enable row level security;
alter table public.precios_cliente_flete enable row level security;

drop policy if exists "parametros_tamanos_paquete_select_autenticados" on public.parametros_tamanos_paquete;
create policy "parametros_tamanos_paquete_select_autenticados" on public.parametros_tamanos_paquete
  for select to authenticated using (true);
drop policy if exists "parametros_tamanos_paquete_write_admin" on public.parametros_tamanos_paquete;
create policy "parametros_tamanos_paquete_write_admin" on public.parametros_tamanos_paquete
  for all to authenticated using (public.tiene_permiso_vista('admin')) with check (public.tiene_permiso_vista('admin'));

drop policy if exists "parametros_cordones_select_autenticados" on public.parametros_cordones;
create policy "parametros_cordones_select_autenticados" on public.parametros_cordones
  for select to authenticated using (true);
drop policy if exists "parametros_cordones_write_admin" on public.parametros_cordones;
create policy "parametros_cordones_write_admin" on public.parametros_cordones
  for all to authenticated using (public.tiene_permiso_vista('admin')) with check (public.tiene_permiso_vista('admin'));

drop policy if exists "precios_cliente_admin" on public.precios_cliente;
create policy "precios_cliente_admin" on public.precios_cliente
  for all to authenticated
  using (public.tiene_permiso_vista('admin'))
  with check (public.tiene_permiso_vista('admin'));

drop policy if exists "precios_cliente_envio_admin" on public.precios_cliente_envio;
create policy "precios_cliente_envio_admin" on public.precios_cliente_envio
  for all to authenticated
  using (public.tiene_permiso_vista('admin'))
  with check (public.tiene_permiso_vista('admin'));

drop policy if exists "precios_cliente_flete_admin" on public.precios_cliente_flete;
create policy "precios_cliente_flete_admin" on public.precios_cliente_flete
  for all to authenticated
  using (public.tiene_permiso_vista('admin'))
  with check (public.tiene_permiso_vista('admin'));
