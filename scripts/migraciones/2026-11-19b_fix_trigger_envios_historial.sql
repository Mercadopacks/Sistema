-- FIX URGENTE: la migración 2026-11-19_auditoria_arquitectura.sql borró
-- la tabla envios_historial asumiendo que estaba muerta (confirmado solo
-- con grep sobre el código de la app — nunca se revisaron los TRIGGERS de
-- Postgres, que es donde en realidad vivía el uso real). Había un trigger
-- real (envios_log_historial(), o nombre similar) que escribía ahí en
-- cada insert/update de envios — al borrar la tabla, ese trigger empezó a
-- fallar con "relation envios_historial does not exist", rompiendo TODA
-- publicación de envíos (bug real 2026-11-19, visto en producción).
--
-- Nada leía envios_historial (confirmado: sí se podía afirmar esa mitad),
-- así que la solución es borrar el trigger, no resucitar la tabla.

do $$
declare
  r record;
begin
  for r in
    select tgname, tgrelid::regclass as tabla
    from pg_trigger
    where tgrelid = 'public.envios'::regclass
      and not tgisinternal
  loop
    raise notice 'Borrando trigger % en %', r.tgname, r.tabla;
    execute format('drop trigger if exists %I on %s', r.tgname, r.tabla);
  end loop;
end $$;

-- Y la función que usaba ese trigger, si existe con el nombre esperado
-- (no rompe nada si no existe o se llama distinto).
drop function if exists public.envios_log_historial() cascade;
