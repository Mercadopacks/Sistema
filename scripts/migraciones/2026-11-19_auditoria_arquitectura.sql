-- Auditoría de arquitectura 2026-11-19 — ver reglas_de_negocio.md changelog
-- para el resumen completo. Idempotente: se puede correr más de una vez
-- sin romper nada (if not exists / or replace / drop if exists en todo).

-- =====================================================================
-- 1. Índice duplicado (bug introducido en la migración del 18/11): dos
--    índices btree sobre la MISMA columna envios.fecha_mercadopacks.
--    Se mantiene el que tiene el nombre que describe la columna real.
-- =====================================================================
drop index if exists public.envios_fecha_idx;

-- =====================================================================
-- 2. Restos muertos: nada en la app ni en los scripts los lee o escribe
--    (confirmado con grep sobre todo el código antes de borrar).
-- =====================================================================
alter table public.asistencia_diaria
  drop column if exists estado_chofer,
  drop column if exists alertado;

drop table if exists public.envios_historial;

-- =====================================================================
-- 3. FK faltante: asistencia_diaria.lightdata_id se copia siempre de
--    choferes_roster.lightdata_id (que ya tiene su propia FK a
--    lightdata_usuarios), así que nunca puede apuntar a algo inválido —
--    agregar la FK acá es solo una red de seguridad extra, sin riesgo de
--    romper nada existente.
-- =====================================================================
alter table public.asistencia_diaria
  add constraint asistencia_diaria_lightdata_id_fkey
  foreign key (lightdata_id) references public.lightdata_usuarios(lightdata_id);

-- =====================================================================
-- 4. Auditoría mínima en fallidos_seguimiento: quién y cuándo tocó un
--    caso por última vez. `actualizado_por` se completa solo (trigger),
--    no depende de que el frontend lo mande.
-- =====================================================================
alter table public.fallidos_seguimiento
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists actualizado_por uuid references auth.users(id);

create or replace function public.set_updated_at_y_actor()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.actualizado_por = auth.uid();
  return new;
end;
$$;

drop trigger if exists fallidos_seguimiento_set_updated_at on public.fallidos_seguimiento;
create trigger fallidos_seguimiento_set_updated_at
  before insert or update on public.fallidos_seguimiento
  for each row execute function public.set_updated_at_y_actor();

-- =====================================================================
-- 5. RLS por vista: hasta ahora, cualquier usuario logueado (sin importar
--    qué vistas_permitidas tenga) podía escribir en TODAS las tablas vía
--    API directa — el sistema de permisos por vista era puramente visual
--    (ocultaba el menú), nunca una barrera real de datos. Esta función
--    replica EXACTO el criterio de puedeVerVista() del frontend
--    (index.html): admin ve todo, sin perfil todavía = fail-open (mismo
--    criterio que el día que se activaron los permisos), si no, tiene que
--    tener la vista en su array.
-- =====================================================================
create or replace function public.tiene_permiso_vista(vista text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.es_admin or vista = any(p.vistas_permitidas)
     from public.perfiles_usuario p
     where p.auth_user_id = auth.uid()),
    true
  );
$$;

-- Tablas de Configuración (vista "admin"): lectura abierta a cualquier
-- autenticado (las necesitan Asistencia/Ruta para sus combos), escritura
-- solo con la vista "admin".
do $$
declare
  t text;
begin
  -- parametros_fallidos_mapeo y parametros_alertas_fallidos NO van acá:
  -- tienen policies con nombres propios (no el patrón genérico "autenticados
  -- leen y escriben..."), se manejan a mano más abajo.
  foreach t in array array[
    'parametros_vehiculos', 'parametros_zonas', 'parametros_turnos',
    'parametros_localidades', 'parametros_alertas',
    'choferes_roster'
  ] loop
    execute format('drop policy if exists "%1$s_select_autenticados" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_write_admin" on public.%1$s', t);
    -- Las policies "ALL ... using(true)" / selects previas de cada tabla
    -- quedan reemplazadas por estas dos (select abierto + write por vista).
    execute format($f$drop policy if exists "autenticados leen y escriben %1$s" on public.%1$s$f$, t);
    execute format('create policy "%1$s_select_autenticados" on public.%1$s for select to authenticated using (true)', t);
    execute format(
      'create policy "%1$s_write_admin" on public.%1$s for all to authenticated using (public.tiene_permiso_vista(''admin'')) with check (public.tiene_permiso_vista(''admin''))',
      t
    );
  end loop;
end $$;

-- parametros_fallidos_mapeo y parametros_alertas_fallidos tenían policies
-- propias con otros nombres (no la genérica "autenticados leen y
-- escriben..." del loop de arriba) — hay que dropearlas a mano, si no las
-- viejas (sin chequeo de vista) quedan conviviendo con las nuevas y el fix
-- no sirve de nada (las policies de un mismo comando se combinan con OR).
drop policy if exists "parametros_fallidos_mapeo_all" on public.parametros_fallidos_mapeo;
create policy "parametros_fallidos_mapeo_select_autenticados" on public.parametros_fallidos_mapeo
  for select to authenticated using (true);
create policy "parametros_fallidos_mapeo_write_admin" on public.parametros_fallidos_mapeo
  for all to authenticated using (public.tiene_permiso_vista('admin')) with check (public.tiene_permiso_vista('admin'));

drop policy if exists "parametros_alertas_fallidos_select" on public.parametros_alertas_fallidos;
drop policy if exists "parametros_alertas_fallidos_update" on public.parametros_alertas_fallidos;
create policy "parametros_alertas_fallidos_select_autenticados" on public.parametros_alertas_fallidos
  for select to authenticated using (true);
create policy "parametros_alertas_fallidos_write_admin" on public.parametros_alertas_fallidos
  for all to authenticated using (public.tiene_permiso_vista('admin')) with check (public.tiene_permiso_vista('admin'));

-- fallidos_seguimiento: la vista "fallidos" gobierna la escritura (select
-- se deja abierto iguaL que antes, son datos operativos de lectura común).
drop policy if exists "fallidos_seguimiento_insert" on public.fallidos_seguimiento;
drop policy if exists "fallidos_seguimiento_update" on public.fallidos_seguimiento;
create policy "fallidos_seguimiento_insert" on public.fallidos_seguimiento
  for insert to authenticated with check (public.tiene_permiso_vista('fallidos'));
create policy "fallidos_seguimiento_update" on public.fallidos_seguimiento
  for update to authenticated using (public.tiene_permiso_vista('fallidos')) with check (public.tiene_permiso_vista('fallidos'));

-- asistencia_diaria: la vista "repa-asistencia" gobierna la escritura.
drop policy if exists "autenticados leen y escriben asistencia_diaria" on public.asistencia_diaria;
create policy "asistencia_diaria_select_autenticados" on public.asistencia_diaria
  for select to authenticated using (true);
create policy "asistencia_diaria_write_vista" on public.asistencia_diaria
  for all to authenticated
  using (public.tiene_permiso_vista('repa-asistencia'))
  with check (public.tiene_permiso_vista('repa-asistencia'));

-- =====================================================================
-- 6b. UPDATE en lote por RPC: el upsert parcial de supabase-py (solo
--     id_interno + chofer_lightdata_id, sin el resto de las columnas
--     NOT NULL de envios) tira "null value in column raw violates not-null
--     constraint" — PostgREST no está resolviendo el ON CONFLICT como
--     UPDATE cuando el payload es parcial (bug real 2026-11-19, visto con
--     vincular_choferes_envios.py y backfill_chofer_lightdata_id.py). Un
--     UPDATE de verdad, en un solo viaje por lote, evita el problema de
--     raíz y de paso es más rápido que upsert fila por fila.
-- =====================================================================
create or replace function public.actualizar_chofer_lightdata_id_lote(ids text[], valores integer[])
returns void
language sql
as $$
  update public.envios e
  set chofer_lightdata_id = v.valor
  from unnest(ids, valores) as v(id_interno, valor)
  where e.id_interno = v.id_interno;
$$;

revoke execute on function public.actualizar_chofer_lightdata_id_lote(text[], integer[]) from public, anon, authenticated;
grant execute on function public.actualizar_chofer_lightdata_id_lote(text[], integer[]) to service_role;

-- =====================================================================
-- 6. Hardening: anon nunca se usa (login 100% Supabase Auth, ver
--    reglas_de_negocio.md sección 4) — saca los privilegios por defecto
--    que quedaron de cuando se crearon las tablas, por las dudas.
-- =====================================================================
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on public.%I from anon', t.tablename);
  end loop;
end $$;
