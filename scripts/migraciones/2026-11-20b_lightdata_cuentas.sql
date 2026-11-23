-- Pedido 2026-11-20: módulo "Clientes" en Configuración (igual que
-- Repartidores) que muestre los datos del cliente + IDs de sus cuentas
-- asociadas (MercadoLibre, Tienda Nube, etc. — ver
-- docs/lightdata_api_clientes.md §3). Hasta ahora `lightdata_clientes`
-- solo tenía los campos mínimos para el combo del ABM de Usuarios
-- (migración 2026-11-20_tipo_usuario_y_acceso_por_cliente.sql); esto
-- agrega la tabla de cuentas, sin columnas de credenciales (nunca se
-- guardan, ver el .md).

create table if not exists public.lightdata_cuentas (
  did bigint primary key,
  did_cliente bigint not null references public.lightdata_clientes(did) on delete cascade,
  tipo_cuenta integer,
  ml_id_vendedor text,
  ml_user text,
  tn_id text,
  tn_url text,
  shop_url text,
  woo_web text,
  vtex_url text,
  vtex_idlogistica text,
  pre_url text,
  fala_url text,
  actualizado_en timestamptz not null default now()
);

create index if not exists lightdata_cuentas_did_cliente_idx on public.lightdata_cuentas(did_cliente);
create index if not exists lightdata_cuentas_ml_id_vendedor_idx on public.lightdata_cuentas(ml_id_vendedor);

alter table public.lightdata_cuentas enable row level security;

create policy "lightdata_cuentas: lectura abierta a autenticados"
on public.lightdata_cuentas
for select
to authenticated
using (true);

grant select on public.lightdata_cuentas to authenticated;
grant all on public.lightdata_cuentas to service_role;
