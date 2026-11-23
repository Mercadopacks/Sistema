-- Picking Tamaños (ver docs/reglas_de_negocio.md, pedido 2026-11-22): puerto
-- de la planilla vieja (Picking.txt/Codigo.txt/Vaciado Nocturno.txt) a
-- Supabase. A diferencia de la planilla, acá no hay límite práctico de
-- filas, así que NO se vacía nunca (confirmado con el usuario) — el
-- historial completo de escaneos vive en esta única tabla.

create table if not exists public.picking_tamanos (
  id bigint generated always as identity primary key,
  escaneo_crudo text not null,
  tamano text not null check (tamano in ('Mediano','Grande')),
  id_normalizado text not null default 'Revisar_Manual',
  tipo_envio text not null default 'Desconocido',
  creado_en timestamptz not null default now()
);

-- Unique parcial (no total): "Revisar_Manual" se repite legítimamente
-- cuando la pistola no pudo extraer un id/tracking/did del string crudo —
-- esos casos quedan para revisar a mano y no deben pisarse entre sí. Solo
-- los id_normalizado "reales" son candidatos a upsert (mismo paquete
-- reescaneado con otro tamaño pisa el escaneo anterior).
create unique index if not exists picking_tamanos_id_normalizado_key
  on public.picking_tamanos (id_normalizado)
  where id_normalizado <> 'Revisar_Manual';

alter table public.picking_tamanos enable row level security;

drop policy if exists "picking_tamanos select" on public.picking_tamanos;
create policy "picking_tamanos select" on public.picking_tamanos
  for select to authenticated using (true);

drop policy if exists "picking_tamanos insert" on public.picking_tamanos;
create policy "picking_tamanos insert" on public.picking_tamanos
  for insert to authenticated with check (true);

drop policy if exists "picking_tamanos update" on public.picking_tamanos;
create policy "picking_tamanos update" on public.picking_tamanos
  for update to authenticated using (true) with check (true);

-- Grants explícitos (ver memoria "feedback_grants_tablas_nuevas" — error
-- recurrente ya cometido más de una vez: sin esto, las policies de RLS ni
-- se evalúan y el frontend ve "permission denied").
grant select, insert, update, delete on public.picking_tamanos to authenticated;
grant all on public.picking_tamanos to service_role;

-- Columna de cruce en Envíos: "Pequeño" es el default implícito para todo
-- envío que nunca pasó por Picking Tamaños (ver index.html, Regla del
-- cruce automático: el último escaneo real siempre pisa este valor).
alter table public.envios add column if not exists tamano text not null default 'Pequeño';

notify pgrst, 'reload schema';
