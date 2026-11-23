-- Sincronización bidireccional de `envios.tamano` <-> `picking_tamanos`
-- (pedido 2026-11-23): hasta ahora el cruce lo hacía la app a mano (un
-- UPDATE explícito en registrarEscaneoPicking() y en
-- importar_picking_historico.py) — eso cubre SOLO el caso "se escanea
-- el paquete y el envío YA existe". Si el envío todavía no estaba
-- sincronizado desde Lightdata en el momento del escaneo, nada volvía a
-- correr el cruce cuando por fin aparecía — quedaba en "Pequeño" (el
-- default) para siempre a menos que se reescaneara a mano.
--
-- Se decidió mantener `tamano` como columna propia de `envios` (no un
-- join en pantalla) porque el usuario confirmó que va a necesitar
-- filtrar/ordenar por Tamaño como cualquier otro filtro de la grilla
-- (Estado, Origen, Zona, etc.) — eso requiere que el filtro se resuelva
-- ANTES del LIMIT/OFFSET de la paginación, a nivel de base, cosa que un
-- join en memoria (JS) o una vista con un join no-sargable (el cruce es
-- id_interno OR tracking, no una sola columna) no puede garantizar a
-- cualquier escala. La columna + un trigger que la mantiene sincronizada
-- SIEMPRE (sin importar el orden de llegada) es la solución correcta acá.

-- `tracking` no tiene índice hoy y se usa constantemente para este cruce
-- (y para buscar/filtrar en el listado de Envíos) — sin esto, cada
-- trigger dispararía un seq scan completo de la tabla.
create index if not exists envios_tracking_idx on public.envios (tracking);

-- 1) picking_tamanos -> envios: cuando se guarda/actualiza un escaneo
-- real (no "Revisar_Manual"), empuja el tamaño a cualquier envío que
-- matchee por id_interno o tracking. Reemplaza el UPDATE manual que antes
-- hacía la app (registrarEscaneoPicking() e importar_picking_historico.py
-- ya no lo necesitan).
create or replace function public.fn_cruzar_tamano_en_envios()
returns trigger
language plpgsql
as $$
begin
  if new.id_normalizado = 'Revisar_Manual' then
    return new;
  end if;

  update public.envios
  set tamano = new.tamano
  where id_interno = new.id_normalizado or tracking = new.id_normalizado;

  return new;
end;
$$;

drop trigger if exists trg_cruzar_tamano_en_envios on public.picking_tamanos;
create trigger trg_cruzar_tamano_en_envios
after insert or update on public.picking_tamanos
for each row execute function public.fn_cruzar_tamano_en_envios();

-- 2) envios -> picking_tamanos: cuando Lightdata sincroniza un envío
-- nuevo (o le cambia el id_interno/tracking, caso raro), resuelve el
-- tamaño buscando si YA había un escaneo real para ese id/tracking antes
-- de que el envío existiera. Si no hay escaneo todavía, el default
-- 'Pequeño' de la columna sigue aplicando sin tocar nada acá.
create or replace function public.fn_resolver_tamano_envio()
returns trigger
language plpgsql
as $$
declare
  v_tamano text;
begin
  select p.tamano into v_tamano
  from public.picking_tamanos p
  where p.id_normalizado <> 'Revisar_Manual'
    and (p.id_normalizado = new.id_interno or p.id_normalizado = new.tracking)
  order by p.creado_en desc
  limit 1;

  if v_tamano is not null then
    new.tamano := v_tamano;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resolver_tamano_envio on public.envios;
create trigger trg_resolver_tamano_envio
before insert or update of id_interno, tracking on public.envios
for each row execute function public.fn_resolver_tamano_envio();

notify pgrst, 'reload schema';
