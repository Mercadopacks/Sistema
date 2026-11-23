-- Pedido 2026-11-23: portar también limpiarCP() de la planilla vieja
-- (Codigo Liquidacion repartidores.txt) al matching de Cordón — hasta
-- ahora solo se hacía trim(cp), sin la extracción de 4 dígitos que sí
-- tenía el código original. Sin esto, un CP con basura (espacios extra,
-- letras, códigos alfanuméricos) podía no matchear aunque la lógica de
-- cascada (CP+Localidad -> CP -> Localidad) estuviera bien.

-- Mismo criterio que limpiarCP(): si hay una corrida de 4 dígitos, usarla
-- tal cual; si no, sacar todo lo que no sea dígito. Null si queda vacío.
create or replace function public.normalizar_cp_localidad(valor text)
returns text
language plpgsql
immutable
as $$
declare
  v_match text;
  v_digits text;
begin
  if valor is null then
    return null;
  end if;
  v_match := substring(trim(valor) from '\d{4}');
  if v_match is not null then
    return v_match;
  end if;
  v_digits := regexp_replace(trim(valor), '\D', '', 'g');
  return nullif(v_digits, '');
end;
$$;

-- Funcional, para que el match por "solo CP" (nivel 2 de la cascada) siga
-- siendo barato aunque la tabla crezca.
create index if not exists parametros_localidad_cps_cp_normalizado_idx
  on public.parametros_localidad_cps (public.normalizar_cp_localidad(cp));

create or replace function public.fn_resolver_cordon_envio()
returns trigger
language plpgsql
as $$
declare
  v_cordon_id bigint;
  v_localidad_id bigint;
  v_cp text := public.normalizar_cp_localidad(new.cp);
  v_nombre_norm text := public.normalizar_texto_localidad(new.localidad);
begin
  if v_nombre_norm = '' and v_cp is null then
    return new;
  end if;

  if v_nombre_norm <> '' and v_cp is not null then
    select c.cordon_id into v_cordon_id
    from public.parametros_localidad_cps c
    join public.parametros_localidades l on l.id = c.localidad_id
    where public.normalizar_texto_localidad(l.nombre) = v_nombre_norm
      and public.normalizar_cp_localidad(c.cp) = v_cp
    limit 1;
  end if;

  if v_cordon_id is null and v_cp is not null then
    select c.cordon_id into v_cordon_id
    from public.parametros_localidad_cps c
    where public.normalizar_cp_localidad(c.cp) = v_cp
    limit 1;
  end if;

  if v_cordon_id is null and v_nombre_norm <> '' then
    select c.cordon_id into v_cordon_id
    from public.parametros_localidad_cps c
    join public.parametros_localidades l on l.id = c.localidad_id
    where public.normalizar_texto_localidad(l.nombre) = v_nombre_norm
    limit 1;
  end if;

  new.cordon_id := v_cordon_id;

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

create or replace function public.fn_cruzar_cordon_en_envios()
returns trigger
language plpgsql
as $$
declare
  v_nombre text;
  v_cp text := public.normalizar_cp_localidad(new.cp);
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
    and public.normalizar_cp_localidad(cp) = v_cp;

  return new;
end;
$$;

create or replace function public.resincronizar_cordones_envios()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actualizados integer := 0;
  v_pendientes_creados integer := 0;
begin
  with resuelto as (
    select e.id_interno,
      coalesce(
        (select c.cordon_id from parametros_localidad_cps c
           join parametros_localidades l on l.id = c.localidad_id
         where normalizar_texto_localidad(l.nombre) = normalizar_texto_localidad(e.localidad)
           and normalizar_cp_localidad(c.cp) = normalizar_cp_localidad(e.cp)
         limit 1),
        (select c.cordon_id from parametros_localidad_cps c
         where normalizar_cp_localidad(c.cp) = normalizar_cp_localidad(e.cp)
         limit 1),
        (select c.cordon_id from parametros_localidad_cps c
           join parametros_localidades l on l.id = c.localidad_id
         where normalizar_texto_localidad(l.nombre) = normalizar_texto_localidad(e.localidad)
         limit 1)
      ) as cordon_id
    from envios e
    where e.cordon_id is null and e.localidad is not null
  )
  update envios e
  set cordon_id = r.cordon_id
  from resuelto r
  where e.id_interno = r.id_interno and r.cordon_id is not null;
  get diagnostics v_actualizados = row_count;

  with candidatos as (
    select distinct trim(e.localidad) as nombre, normalizar_texto_localidad(e.localidad) as nombre_norm, normalizar_cp_localidad(e.cp) as cp
    from envios e
    where e.cordon_id is null and e.localidad is not null and e.cp is not null
  ),
  candidatos_validos as (
    select * from candidatos where cp is not null
  ),
  nuevas_localidades as (
    insert into parametros_localidades (nombre, activo)
    select distinct on (c.nombre_norm) c.nombre, true
    from candidatos_validos c
    where not exists (
      select 1 from parametros_localidades l
      where normalizar_texto_localidad(l.nombre) = c.nombre_norm
    )
    returning id, normalizar_texto_localidad(nombre) as nombre_norm
  ),
  todas_localidades as (
    select id, normalizar_texto_localidad(nombre) as nombre_norm from parametros_localidades
    union all
    select id, nombre_norm from nuevas_localidades
  ),
  insertados as (
    insert into parametros_localidad_cps (localidad_id, cp)
    select distinct tl.id, c.cp
    from candidatos_validos c
    join todas_localidades tl on tl.nombre_norm = c.nombre_norm
    on conflict (localidad_id, cp) do nothing
    returning id
  )
  select count(*) into v_pendientes_creados from insertados;

  return jsonb_build_object('actualizados', v_actualizados, 'pendientes_creados', v_pendientes_creados);
end;
$$;

notify pgrst, 'reload schema';
