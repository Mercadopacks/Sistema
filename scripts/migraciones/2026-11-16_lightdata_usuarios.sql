-- Integración: validar/completar altas de choferes contra la base de
-- usuarios de Lightdata. Ver integracion_usuarios_lightdata.md (raíz del
-- repo) para el contexto completo y el detalle de cada campo.

-- Espejo de la base de usuarios de Lightdata (solo lectura para el
-- usuario final del dashboard; la escribe sincronizar_lightdata.py).
create table if not exists public.lightdata_usuarios (
  lightdata_id          integer primary key,
  nombre                text not null default '',
  apellido              text not null default '',
  usuario               text not null default '',
  usuario_norm          text not null default '',
  nombre_completo_norm  text not null default '',
  perfil                text not null default '',
  habilitado            boolean not null default true,
  bloqueado             boolean not null default false,
  codigo_empleado       text,
  actualizado_en        timestamptz not null default now(),
  activo_en_ultima_import boolean not null default true
);

create index if not exists lightdata_usuarios_usuario_norm_idx on public.lightdata_usuarios (usuario_norm);
create index if not exists lightdata_usuarios_nombre_completo_norm_idx on public.lightdata_usuarios (nombre_completo_norm);

alter table public.lightdata_usuarios enable row level security;

create policy "lightdata_usuarios: lectura autenticados"
  on public.lightdata_usuarios for select
  to authenticated
  using (true);

grant select on public.lightdata_usuarios to authenticated;
grant select, insert, update, delete on public.lightdata_usuarios to service_role;

-- Vínculo con el roster propio de choferes: de dónde salió el alta y si
-- todavía le faltan los datos que no trae Lightdata (vehículo, zona,
-- localidad, turno).
alter table public.choferes_roster
  add column if not exists lightdata_id integer references public.lightdata_usuarios(lightdata_id),
  add column if not exists pendiente_completar boolean not null default false;

create unique index if not exists choferes_roster_lightdata_id_idx on public.choferes_roster (lightdata_id) where lightdata_id is not null;
