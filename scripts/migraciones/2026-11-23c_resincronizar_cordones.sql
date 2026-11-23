-- Pedido 2026-11-23: botón manual en Localidades para re-sincronizar el
-- cordón de TODOS los envíos sin clasificar — por si el trigger
-- trg_resolver_cordon_envio llegara a fallar para algún envío puntual (o
-- para re-aplicar el mapeo después de clasificar varias localidades de
-- una sentada, sin esperar a que Lightdata vuelva a tocar cada envío).
--
-- SECURITY DEFINER a propósito: el UPDATE de acá toca la columna
-- `localidad`/`cp` indirectamente al re-evaluar, y `authenticated` solo
-- tiene grant de UPDATE en (tamano, cordon_id) — esta función corre con
-- los privilegios de quien la creó (dueño del esquema), no con los del
-- que la llama, para no tener que ampliar más el grant de `envios`.
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
  -- 1) Envíos sin cordón que SÍ matchean algo ya cargado en
  -- parametros_localidad_cps (cascada CP+Localidad -> CP -> Localidad,
  -- igual que el trigger).
  with resuelto as (
    select e.id_interno,
      coalesce(
        (select c.cordon_id from parametros_localidad_cps c
           join parametros_localidades l on l.id = c.localidad_id
         where public.normalizar_texto_localidad(l.nombre) = public.normalizar_texto_localidad(e.localidad)
           and trim(c.cp) = trim(e.cp)
         limit 1),
        (select c.cordon_id from parametros_localidad_cps c
         where trim(c.cp) = trim(e.cp)
         limit 1),
        (select c.cordon_id from parametros_localidad_cps c
           join parametros_localidades l on l.id = c.localidad_id
         where public.normalizar_texto_localidad(l.nombre) = public.normalizar_texto_localidad(e.localidad)
         limit 1)
      ) as cordon_id
    from public.envios e
    where e.cordon_id is null and e.localidad is not null
  )
  update public.envios e
  set cordon_id = r.cordon_id
  from resuelto r
  where e.id_interno = r.id_interno and r.cordon_id is not null;
  get diagnostics v_actualizados = row_count;

  -- 2) Lo que sigue sin matchear: encolar como pendiente (creando la
  -- localidad maestra si hace falta), igual que hace el trigger para un
  -- envío nuevo.
  with candidatos as (
    select distinct trim(e.localidad) as nombre, public.normalizar_texto_localidad(e.localidad) as nombre_norm, trim(e.cp) as cp
    from public.envios e
    where e.cordon_id is null and e.localidad is not null and e.cp is not null
  ),
  nuevas_localidades as (
    insert into public.parametros_localidades (nombre, activo)
    select distinct on (c.nombre_norm) c.nombre, true
    from candidatos c
    where not exists (
      select 1 from public.parametros_localidades l
      where public.normalizar_texto_localidad(l.nombre) = c.nombre_norm
    )
    returning id, public.normalizar_texto_localidad(nombre) as nombre_norm
  ),
  todas_localidades as (
    select id, public.normalizar_texto_localidad(nombre) as nombre_norm from public.parametros_localidades
    union all
    select id, nombre_norm from nuevas_localidades
  ),
  insertados as (
    insert into public.parametros_localidad_cps (localidad_id, cp)
    select distinct tl.id, c.cp
    from candidatos c
    join todas_localidades tl on tl.nombre_norm = c.nombre_norm
    on conflict (localidad_id, cp) do nothing
    returning id
  )
  select count(*) into v_pendientes_creados from insertados;

  return jsonb_build_object('actualizados', v_actualizados, 'pendientes_creados', v_pendientes_creados);
end;
$$;

grant execute on function public.resincronizar_cordones_envios() to authenticated;

notify pgrst, 'reload schema';
