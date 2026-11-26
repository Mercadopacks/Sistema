-- Pedido 2026-11-26: el usuario pidió una forma de configurar ÉL MISMO
-- qué vistas puede ver un usuario tipo "cliente" al asignar "Vistas
-- permitidas" en Usuarios — hasta ahora era un flag `soloAdmin`/
-- `paraCliente` HARDCODEADO en js/core/sesion.js (VISTAS_DISPONIBLES),
-- que ya se equivocó 2 veces (Liquidación Consolidada quedó marcada
-- soloAdmin por copiar el patrón de Liquidación Clientes, pisando el
-- acceso que el propio módulo necesita). Se saca esa decisión del código
-- y pasa a una tabla editable desde Configuración → "Vistas" (nueva
-- pantalla, ver js/admin/parametros-vistas.js) — nunca más requiere un
-- cambio de código para habilitar/deshabilitar una vista para clientes.
create table if not exists public.parametros_vistas (
  clave text primary key,
  label text not null,
  visible_para_clientes boolean not null default false,
  actualizado_en timestamptz not null default now()
);
comment on table public.parametros_vistas is 'Qué vistas (VISTAS_DISPONIBLES en sesion.js) son asignables a un usuario tipo_usuario=cliente — editable desde Configuración, reemplaza los flags soloAdmin/paraCliente que vivían hardcodeados en el JS.';

-- Lectura abierta a cualquier autenticado (son solo nombres + un booleano,
-- nada sensible) — la escritura queda admin-only.
alter table public.parametros_vistas enable row level security;
drop policy if exists "parametros_vistas select" on public.parametros_vistas;
create policy "parametros_vistas select" on public.parametros_vistas
  for select to authenticated using (true);
drop policy if exists "parametros_vistas admin write" on public.parametros_vistas;
create policy "parametros_vistas admin write" on public.parametros_vistas
  for all to authenticated
  using (public.tiene_permiso_vista('admin'))
  with check (public.tiene_permiso_vista('admin'));

grant select, insert, update, delete on public.parametros_vistas to authenticated;

-- Semilla: mismo comportamiento que el código hardcodeado tenía HOY
-- (antes de este cambio), para no alterar accesos ya configurados —
-- `on conflict do nothing` para poder re-correr esta migración sin pisar
-- lo que un admin ya haya tocado desde la pantalla nueva.
insert into public.parametros_vistas (clave, label, visible_para_clientes) values
  ('mis-liquidaciones', 'Mis Liquidaciones', true),
  ('envios', 'Dashboard de Envíos', true),
  ('envios-listado', 'Envíos', true),
  ('fallidos', 'Fallidos y Cambios', true),
  ('picking-tamanos', 'Picking Tamaños', true),
  ('repa-ruta', 'Seguimiento en Ruta', true),
  ('repa-asistencia', 'Asistencia de Repartidores', true),
  ('repa-vivo', 'Operación en vivo', true),
  ('liquidacion-clientes', 'Liquidación Clientes', false),
  ('liquidacion-repartidores', 'Liquidación Repartidores', false),
  ('liquidacion-consolidada', 'Liquidación Consolidada', true),
  ('extras-liquidacion-clientes', 'Adicionales (Clientes)', false),
  ('extras-liquidacion-repartidores', 'Adicionales (Repartidores)', false),
  ('admin', 'Administración', false)
on conflict (clave) do nothing;

notify pgrst, 'reload schema';
