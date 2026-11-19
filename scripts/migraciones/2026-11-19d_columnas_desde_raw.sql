-- Promueve todo lo que vive dentro de envios.raw a columnas propias
-- (pedido 2026-11-19, ver reglas_de_negocio.md changelog) y separa los
-- 5 campos sensibles del destinatario en una tabla aparte con su propia
-- RLS, cerrada por default (nada en la UI los necesita hoy — se abre el
-- día que haga falta mostrarlos a alguien puntual).
--
-- Paso 1 de 2 (aditivo, no rompe nada): agrega columnas, crea la tabla
-- nueva, relaja el NOT NULL de `raw` para que publicar_supabase.py pueda
-- dejar de escribirla sin romper el insert. El DROP de `raw` va en una
-- migración aparte, después de correr el backfill y confirmar que todo
-- quedó bien.

-- Campos no sensibles nuevos (ver diccionario_de_datos.md para el
-- significado de cada uno; los que ya eran columna propia -zona, cadete,
-- estado, localidad, observaciones, logistica_inversa, las 4 fechas- no
-- se tocan).
alter table public.envios
  add column if not exists cp text,
  add column if not exists origen text,
  add column if not exists precio numeric,
  add column if not exists provincia text,
  add column if not exists cod_cliente text,
  add column if not exists fecha_venta timestamptz,
  add column if not exists id_venta_ml text,
  add column if not exists zona_precio text,
  add column if not exists quien_estado text,
  add column if not exists razon_social text,
  add column if not exists url_tracking text,
  add column if not exists fecha_colecta timestamptz,
  add column if not exists nombre_cuenta text,
  add column if not exists usuario_ml_id text,
  add column if not exists tipo_direccion text,
  add column if not exists total_a_cobrar numeric,
  add column if not exists metodo_envio text,
  add column if not exists comentario_destino text,
  -- Estos dos NO vienen del Excel: salen del endpoint JSON de envíos que
  -- ya usa vincular_choferes_envios.py (estadoml/didCliente, ver
  -- lightdata_api_envios.md) — nulos para envíos de días que ese script
  -- todavía no procesó, igual que pasó con chofer_lightdata_id.
  add column if not exists estado_ml text,
  add column if not exists did_cliente integer;

alter table public.envios alter column raw drop not null;

-- Tabla de datos sensibles del destinatario, separada a propósito: RLS
-- por fila no alcanza para esconder columnas dentro de la misma tabla
-- (si "envios" tiene SELECT abierto a cualquier authenticated, cualquier
-- columna de esa fila se ve, sin importar si está en un jsonb o no) — la
-- única forma real de aislarlo es con otra tabla y su propia policy.
create table if not exists public.envios_contacto_destinatario (
  id_interno text primary key references public.envios(id_interno) on delete cascade,
  nombre_destinatario text,
  direccion text,
  telefono_destinatario text,
  email_destinatario text,
  latitud double precision,
  longitud double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.envios_contacto_destinatario enable row level security;

-- A propósito, SIN policy para `authenticated`: nada en la UI usa estos
-- datos hoy, así que queda cerrado (nadie lo puede leer vía la app) hasta
-- que haga falta de verdad — ahí se agrega una policy gateada por
-- tiene_permiso_vista() como las demás, no por "estar logueado" nomás.
grant select, insert, update, delete on public.envios_contacto_destinatario to service_role;

-- UPDATE en lote (mismo patrón que las migraciones anteriores — un
-- upsert/insert parcial contra una tabla con columnas NOT NULL ya nos
-- rompió dos veces, ver reglas_de_negocio.md) para el backfill único de
-- los ~24k envíos existentes. jsonb en vez de arrays paralelos porque acá
-- son muchas columnas a la vez.
create or replace function public.actualizar_envio_campos_lote(filas jsonb)
returns void
language sql
as $$
  update public.envios e set
    cp = x.cp,
    origen = x.origen,
    precio = x.precio,
    provincia = x.provincia,
    cod_cliente = x.cod_cliente,
    fecha_venta = x.fecha_venta,
    id_venta_ml = x.id_venta_ml,
    zona_precio = x.zona_precio,
    quien_estado = x.quien_estado,
    razon_social = x.razon_social,
    url_tracking = x.url_tracking,
    fecha_colecta = x.fecha_colecta,
    nombre_cuenta = x.nombre_cuenta,
    usuario_ml_id = x.usuario_ml_id,
    tipo_direccion = x.tipo_direccion,
    total_a_cobrar = x.total_a_cobrar,
    metodo_envio = x.metodo_envio,
    comentario_destino = x.comentario_destino
  from jsonb_to_recordset(filas) as x(
    id_interno text, cp text, origen text, precio numeric, provincia text,
    cod_cliente text, fecha_venta timestamptz, id_venta_ml text, zona_precio text,
    quien_estado text, razon_social text, url_tracking text, fecha_colecta timestamptz,
    nombre_cuenta text, usuario_ml_id text, tipo_direccion text, total_a_cobrar numeric,
    metodo_envio text, comentario_destino text
  )
  where e.id_interno = x.id_interno;
$$;

revoke execute on function public.actualizar_envio_campos_lote(jsonb) from public, anon, authenticated;
grant execute on function public.actualizar_envio_campos_lote(jsonb) to service_role;

-- Reemplaza actualizar_chofer_lightdata_id_lote + actualizar_logistica_inversa_lote
-- (de las migraciones del 18 y 19/11) por una sola función que actualiza
-- las 4 columnas que vienen del endpoint JSON de envíos en vivo en un
-- solo viaje por lote, en vez de dos. chofer_lightdata_id usa coalesce
-- para no pisar el valor existente cuando la fila no trae cadete asignado
-- (mismo comportamiento que antes: esos envíos simplemente no venían en
-- el payload).
create or replace function public.actualizar_envio_lightdata_vivo_lote(filas jsonb)
returns void
language sql
as $$
  update public.envios e set
    chofer_lightdata_id = coalesce(x.chofer_lightdata_id, e.chofer_lightdata_id),
    logistica_inversa_real = x.logistica_inversa_real,
    estado_ml = x.estado_ml,
    did_cliente = x.did_cliente
  from jsonb_to_recordset(filas) as x(
    id_interno text, chofer_lightdata_id integer, logistica_inversa_real boolean,
    estado_ml text, did_cliente integer
  )
  where e.id_interno = x.id_interno;
$$;

revoke execute on function public.actualizar_envio_lightdata_vivo_lote(jsonb) from public, anon, authenticated;
grant execute on function public.actualizar_envio_lightdata_vivo_lote(jsonb) to service_role;

drop function if exists public.actualizar_chofer_lightdata_id_lote(text[], integer[]);
drop function if exists public.actualizar_logistica_inversa_lote(text[], boolean[]);
