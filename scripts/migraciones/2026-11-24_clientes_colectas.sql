-- Pedido 2026-11-24: nueva sección en el ABM de Clientes para cargar
-- Dirección + días de trabajo (colecta) — puerto de la hoja
-- "Base_Colectas" de "1. Informacion Base Repartidores.xlsx". Un mismo
-- cliente puede tener VARIAS direcciones/turnos de colecta (confirmado
-- con los datos reales: ej. "ABELSON" tiene turno Mañana y Tarde en la
-- misma dirección; "ABRAFER" tiene 2 direcciones distintas) — por eso es
-- una tabla hija, no columnas sueltas en lightdata_clientes.

create table if not exists public.clientes_colectas (
  id bigint generated always as identity primary key,
  did_cliente bigint not null references public.lightdata_clientes(did),
  direccion text not null,
  localidad text,
  turno text,
  dias text,
  refuerzo boolean not null default false,
  hora time,
  observaciones text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index if not exists clientes_colectas_cliente_idx on public.clientes_colectas (did_cliente);

alter table public.clientes_colectas enable row level security;
drop policy if exists "clientes_colectas select" on public.clientes_colectas;
create policy "clientes_colectas select" on public.clientes_colectas for select to authenticated using (true);
drop policy if exists "clientes_colectas insert" on public.clientes_colectas;
create policy "clientes_colectas insert" on public.clientes_colectas for insert to authenticated with check (true);
drop policy if exists "clientes_colectas update" on public.clientes_colectas;
create policy "clientes_colectas update" on public.clientes_colectas for update to authenticated using (true) with check (true);
drop policy if exists "clientes_colectas delete" on public.clientes_colectas;
create policy "clientes_colectas delete" on public.clientes_colectas for delete to authenticated using (true);

grant select, insert, update, delete on public.clientes_colectas to authenticated;
grant all on public.clientes_colectas to service_role;

notify pgrst, 'reload schema';
