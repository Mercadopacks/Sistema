-- Pedido 2026-11-20: el ABM de Usuarios necesita distinguir usuarios
-- "Cliente" (acceso acotado a SU información, ej. sus propios envíos) de
-- "Administrativo" (personal de la empresa, ve todo). El campo "sector"
-- (texto libre) se reemplaza por esta distinción real de control de
-- acceso + una lista cerrada de sectores (Regla 4 de sección 1,
-- reglas_de_negocio.md: todo campo de opciones fijas es su propia tabla,
-- nunca texto libre).
--
-- No se borra la columna `sector` vieja todavía (dato histórico, dos
-- usuarios la tienen cargada) — queda deprecada, se puede borrar en una
-- migración aparte una vez migrado el dato a mano si hace falta.

-- 1) Clientes de Lightdata (sincronizados por
--    scripts/ingesta_lightdata/sincronizar_clientes_lightdata.py) — hace
--    falta tener el nombre real para que el ABM los busque por nombre,
--    no por ID a mano (ver lightdata_api_clientes.md).
create table if not exists public.lightdata_clientes (
  did bigint primary key,
  codigo text,
  nombre_fantasia text,
  razon_social text,
  habilitado boolean not null default true,
  actualizado_en timestamptz not null default now()
);

alter table public.lightdata_clientes enable row level security;

-- Lectura abierta a cualquier autenticado (hace falta para el combo del
-- ABM de Usuarios, igual criterio que combos de otras pantallas, ver
-- sección 2 de reglas_de_negocio.md). Escritura exclusiva de service_role
-- (lo llena el script de sincronización, nunca el frontend).
create policy "lightdata_clientes: lectura abierta a autenticados"
on public.lightdata_clientes
for select
to authenticated
using (true);

grant select on public.lightdata_clientes to authenticated;
grant all on public.lightdata_clientes to service_role;

-- 2) Lista cerrada de sectores (reemplaza el texto libre viejo). ABM
--    simple desde Configuración, reusando la fábrica `crearAbmSimple()`
--    del frontend (misma forma que Vehículos/Zonas/Localidades: id +
--    nombre + activo).
create table if not exists public.parametros_sectores (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true
);

alter table public.parametros_sectores enable row level security;

create policy "parametros_sectores: lectura abierta a autenticados"
on public.parametros_sectores
for select
to authenticated
using (true);

create policy "parametros_sectores: escritura solo vista admin"
on public.parametros_sectores
for all
to authenticated
using (public.tiene_permiso_vista('admin'))
with check (public.tiene_permiso_vista('admin'));

grant select, insert, update, delete on public.parametros_sectores to authenticated;
grant all on public.parametros_sectores to service_role;

-- Backfill: arranca la lista con los valores reales que ya existían en
-- el texto libre `sector` (limpios, sin duplicar por mayúsculas/espacios),
-- para no partir de una lista vacía. El admin la edita después desde
-- Configuración si hace falta.
insert into public.parametros_sectores (nombre)
select distinct initcap(trim(sector))
from public.perfiles_usuario
where sector is not null and trim(sector) <> ''
on conflict (nombre) do nothing;

-- 3) perfiles_usuario: tipo de usuario + asociación según el tipo.
alter table public.perfiles_usuario
  add column if not exists tipo_usuario text not null default 'administrativo'
    check (tipo_usuario in ('administrativo', 'cliente')),
  add column if not exists sector_id bigint references public.parametros_sectores(id),
  add column if not exists clientes_lightdata_ids bigint[];

comment on column public.perfiles_usuario.sector is
  'Deprecado 2026-11-20, reemplazado por sector_id (lista cerrada) — se mantiene solo como dato histórico, no se usa más en el ABM.';

-- Backfill best-effort: matchea el sector_id contra el texto viejo
-- normalizado igual que el insert de arriba.
update public.perfiles_usuario pu
set sector_id = ps.id
from public.parametros_sectores ps
where pu.sector_id is null
  and pu.sector is not null and trim(pu.sector) <> ''
  and ps.nombre = initcap(trim(pu.sector));

-- 4) Función que decide si el usuario logueado puede ver un envío de un
--    cliente puntual — admin ve todo (mismo fail-open que
--    tiene_permiso_vista), administrativo ve todo, cliente solo ve los
--    suyos (incluido el caso sin perfil todavía, fail-open deliberado,
--    igual criterio que el resto del sistema de permisos).
create or replace function public.puede_ver_envio_de_cliente(p_did_cliente bigint)
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (
      select
        p.es_admin
        or p.tipo_usuario <> 'cliente'
        or (p_did_cliente is not null and p_did_cliente = any(coalesce(p.clientes_lightdata_ids, array[]::bigint[])))
      from public.perfiles_usuario p
      where p.auth_user_id = auth.uid()
    ),
    true -- sin perfil todavía: fail-open, mismo criterio que tiene_permiso_vista()
  );
$$;

-- 5) Policies RESTRICTIVAS (se combinan con AND sobre cualquier policy
--    permisiva que ya exista en estas tablas, nunca las reemplazan ni
--    hace falta saber su nombre/definición exacta — ver nota en
--    reglas_de_negocio.md sección 2 sobre por qué esto es necesario y no
--    alcanza con "agregar una policy más").
create policy "acceso por cliente: envios"
on public.envios
as restrictive
for select
to authenticated
using (public.puede_ver_envio_de_cliente(did_cliente));

create policy "acceso por cliente: envios_contacto_destinatario"
on public.envios_contacto_destinatario
as restrictive
for select
to authenticated
using (
  exists (
    select 1 from public.envios e
    where e.id_interno = envios_contacto_destinatario.id_interno
      and public.puede_ver_envio_de_cliente(e.did_cliente)
  )
);

create policy "acceso por cliente: fallidos_seguimiento"
on public.fallidos_seguimiento
as restrictive
for select
to authenticated
using (
  exists (
    select 1 from public.envios e
    where e.id_interno = fallidos_seguimiento.id_interno
      and public.puede_ver_envio_de_cliente(e.did_cliente)
  )
);
