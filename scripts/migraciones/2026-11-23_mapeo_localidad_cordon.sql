-- Mapeo Localidad+CP -> Cordón (pedido 2026-11-23): puerto de la hoja
-- "Base_Zonas" de la planilla vieja. envios.zona viene crudo de Lightdata y
-- no es confiable del todo (ej. "Buenos Aires" en Lightdata figura como una
-- sola zona, pero según el CP real puede ser CABA, GBA1 o GBA2) — de acá en
-- más esa clasificación la hacemos nosotros, por Localidad+CP, reusando el
-- ABM de Cordones (CABA/GBA1/GBA2/GBA3) ya existente.
--
-- Importante: una misma Localidad puede caer en MÁS DE UN Cordón según el
-- CP (confirmado contra los datos reales: 8 localidades de "Base_Zonas"
-- tienen CPs en cordones distintos) — por eso NO alcanza con una columna
-- cordon_id en parametros_localidades (ahí vive 1 sola fila por nombre). Se
-- separa en una tabla hija con 1 fila por combinación Localidad+CP.

create extension if not exists unaccent;

-- Normalización reusable: mayúsculas + sin acentos + sin espacios de más.
-- Mismo criterio que limpiarTexto() de la planilla vieja (Codigo.txt) —
-- necesario porque Lightdata y los Excels traen el mismo nombre de
-- localidad con mayúsculas/acentos inconsistentes.
create or replace function public.normalizar_texto_localidad(valor text)
returns text
language sql
immutable
as $$
  select upper(trim(unaccent(coalesce(valor, ''))));
$$;

-- parametros_localidades vuelve a ser SOLO la lista simple de nombres (la
-- que ya usan los desplegables de Asistencia/Choferes) — cp/cordon_id se
-- mudan a la tabla hija de abajo. Confirmado antes de migrar: ninguna fila
-- tenía esas 2 columnas cargadas todavía (feature armada pero sin usar).
alter table public.parametros_localidades drop column if exists cp;
alter table public.parametros_localidades drop column if exists cordon_id;

create table if not exists public.parametros_localidad_cps (
  id bigint generated always as identity primary key,
  localidad_id bigint not null references public.parametros_localidades(id) on delete cascade,
  cp text not null,
  cordon_id bigint references public.parametros_cordones(id),
  creado_en timestamptz not null default now(),
  unique (localidad_id, cp)
);

create index if not exists parametros_localidad_cps_cp_idx on public.parametros_localidad_cps (cp);

alter table public.parametros_localidad_cps enable row level security;

drop policy if exists "parametros_localidad_cps select" on public.parametros_localidad_cps;
create policy "parametros_localidad_cps select" on public.parametros_localidad_cps
  for select to authenticated using (true);
drop policy if exists "parametros_localidad_cps insert" on public.parametros_localidad_cps;
create policy "parametros_localidad_cps insert" on public.parametros_localidad_cps
  for insert to authenticated with check (true);
drop policy if exists "parametros_localidad_cps update" on public.parametros_localidad_cps;
create policy "parametros_localidad_cps update" on public.parametros_localidad_cps
  for update to authenticated using (true) with check (true);
drop policy if exists "parametros_localidad_cps delete" on public.parametros_localidad_cps;
create policy "parametros_localidad_cps delete" on public.parametros_localidad_cps
  for delete to authenticated using (true);

grant select, insert, update, delete on public.parametros_localidad_cps to authenticated;
grant all on public.parametros_localidad_cps to service_role;

-- Columna de cruce en Envíos: "sin clasificar" se representa como NULL (a
-- diferencia de Tamaño, acá no hay un default razonable tipo "Pequeño" —
-- hasta no tener el CP mapeado, no hay forma de saber el cordón real).
alter table public.envios add column if not exists cordon_id bigint references public.parametros_cordones(id);

-- 1) envios -> parametros_localidad_cps: resuelve el cordón apenas se
-- sincroniza/actualiza un envío. Cascada igual a la planilla vieja
-- (actualizarCruces() de Codigo Liquidacion repartidores.txt): CP+Localidad
-- exacto -> solo CP -> solo Localidad. Si no matchea nada, deja el envío
-- sin cordón Y agrega la combinación a la cola de pendientes (creando la
-- localidad maestra si hace falta) para clasificar a mano desde la
-- pantalla de Localidades — mismo criterio que "zonasNuevasParaBase" de la
-- planilla, pero automático acá.
create or replace function public.fn_resolver_cordon_envio()
returns trigger
language plpgsql
as $$
declare
  v_cordon_id bigint;
  v_localidad_id bigint;
  v_cp text := nullif(trim(new.cp), '');
  v_nombre_norm text := public.normalizar_texto_localidad(new.localidad);
begin
  if v_nombre_norm = '' and v_cp is null then
    return new;
  end if;

  -- Nivel 1: CP + Localidad exacto.
  if v_nombre_norm <> '' and v_cp is not null then
    select c.cordon_id into v_cordon_id
    from public.parametros_localidad_cps c
    join public.parametros_localidades l on l.id = c.localidad_id
    where public.normalizar_texto_localidad(l.nombre) = v_nombre_norm
      and trim(c.cp) = v_cp
    limit 1;
  end if;

  -- Nivel 2: solo CP.
  if v_cordon_id is null and v_cp is not null then
    select c.cordon_id into v_cordon_id
    from public.parametros_localidad_cps c
    where trim(c.cp) = v_cp
    limit 1;
  end if;

  -- Nivel 3: solo Localidad (cualquiera de sus CPs).
  if v_cordon_id is null and v_nombre_norm <> '' then
    select c.cordon_id into v_cordon_id
    from public.parametros_localidad_cps c
    join public.parametros_localidades l on l.id = c.localidad_id
    where public.normalizar_texto_localidad(l.nombre) = v_nombre_norm
    limit 1;
  end if;

  new.cordon_id := v_cordon_id;

  -- Sin match en ningún nivel: encolar para clasificar a mano (solo si hay
  -- CP real — sin CP no hay nada que clasificar).
  if v_cordon_id is null and v_nombre_norm <> '' and v_cp is not null then
    select id into v_localidad_id
    from public.parametros_localidades
    where public.normalizar_texto_localidad(nombre) = v_nombre_norm
    limit 1;

    if v_localidad_id is null then
      insert into public.parametros_localidades (nombre, activo)
      values (trim(new.localidad), true)
      returning id into v_localidad_id;
    end if;

    insert into public.parametros_localidad_cps (localidad_id, cp)
    values (v_localidad_id, v_cp)
    on conflict (localidad_id, cp) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resolver_cordon_envio on public.envios;
create trigger trg_resolver_cordon_envio
before insert or update of localidad, cp on public.envios
for each row execute function public.fn_resolver_cordon_envio();

-- 2) parametros_localidad_cps -> envios: cuando se clasifica (o reclasifica)
-- un CP a mano desde la pantalla de Localidades, reaplica el cordón a
-- todos los envíos que matcheen esa Localidad+CP.
create or replace function public.fn_cruzar_cordon_en_envios()
returns trigger
language plpgsql
as $$
declare
  v_nombre text;
begin
  if new.cordon_id is null then
    return new;
  end if;

  select nombre into v_nombre from public.parametros_localidades where id = new.localidad_id;
  if v_nombre is null then
    return new;
  end if;

  update public.envios
  set cordon_id = new.cordon_id
  where public.normalizar_texto_localidad(localidad) = public.normalizar_texto_localidad(v_nombre)
    and trim(cp) = trim(new.cp);

  return new;
end;
$$;

drop trigger if exists trg_cruzar_cordon_en_envios on public.parametros_localidad_cps;
create trigger trg_cruzar_cordon_en_envios
after insert or update on public.parametros_localidad_cps
for each row execute function public.fn_cruzar_cordon_en_envios();

notify pgrst, 'reload schema';
