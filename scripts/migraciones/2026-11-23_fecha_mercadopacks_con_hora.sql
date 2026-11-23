-- Pedido 2026-11-23: `envios.fecha_mercadopacks` se guardaba truncada a
-- solo fecha ([:10] en publicar_supabase.py) aunque Lightdata manda fecha
-- Y hora reales para ese campo. Se migra la columna de `date` a
-- `timestamptz` para no perder la hora de acá en más.
--
-- Blast radius real (no es solo mostrar la hora): 2 funciones SQL
-- dependen de esta columna con comparaciones exactas de fecha
-- (`= p_fecha` / `between fecha_desde and fecha_hasta`) que se rompen si
-- la columna pasa a tener hora — se reescriben acá para comparar por
-- RANGO de día, en huso horario de Argentina explícito (mismo criterio
-- fijo ART = UTC-3 que ya usa parsear_fecha() en la ingesta — sin esto,
-- el server de Postgres podría interpretar una fecha pelada con SU
-- propio timezone de sesión, no necesariamente ART, y correr el límite
-- del día varias horas).

alter table public.envios
  alter column fecha_mercadopacks type timestamptz
  using (fecha_mercadopacks::timestamp at time zone 'America/Argentina/Buenos_Aires');

-- "Seguimiento en Ruta" (choferes_en_ruta): antes `where fecha_mercadopacks
-- = p_fecha` (exacto); ahora rango [p_fecha 00:00 ART, p_fecha+1 00:00 ART).
create or replace function public.choferes_en_ruta(p_fecha date)
 returns jsonb
 language sql
 stable
as $function$
with base as (
  select
    cadete,
    coalesce(nullif(localidad, ''), '') as localidad,
    estado,
    fecha_estado,
    (estado in ('Entregado', 'Entregado 2DA visita')) as es_entrega,
    (lower(trim(estado)) in (
      'nadie', 'nadie 2da visita', 'reprogramado por comprador',
      'rechazado por el comprador', 'reprogramado por meli', 'cancelado', 'no entregado'
    )) as es_gestionado
  from public.envios
  where fecha_mercadopacks >= (p_fecha::timestamp at time zone 'America/Argentina/Buenos_Aires')
    and fecha_mercadopacks < ((p_fecha + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
    and cadete is not null and cadete <> ''
    and estado <> 'A retirar'
),
entregas_diff as (
  select cadete, fecha_estado,
    extract(epoch from (fecha_estado - lag(fecha_estado) over (partition by cadete order by fecha_estado))) / 60.0 as diff_min
  from base
  where es_entrega and fecha_estado is not null
),
ritmo as (
  select cadete, round(avg(diff_min)::numeric, 1) as min_entre_entregas
  from entregas_diff
  group by 1
),
primera_entrega as (
  select cadete, min(fecha_estado) as hora_primera_entrega
  from base where es_entrega and fecha_estado is not null
  group by 1
),
ultima_actividad as (
  select cadete, max(fecha_estado) as hora_ultima_actividad
  from base where fecha_estado is not null
  group by 1
),
pre21 as (
  select cadete, count(*) as entregados_pre21
  from base
  where es_entrega and fecha_estado is not null
    and extract(hour from fecha_estado at time zone 'America/Argentina/Buenos_Aires') < 21
  group by 1
),
localidad_counts as (
  select cadete, localidad, count(*) as cnt
  from base
  group by 1, 2
),
localidades_agg as (
  select cadete, jsonb_object_agg(localidad, cnt) as localidades
  from localidad_counts
  group by 1
),
agg as (
  select
    cadete,
    count(*) as asignados,
    count(*) filter (where es_entrega) as entregados,
    count(*) filter (where not es_entrega) as pendientes,
    count(*) filter (where not es_entrega and es_gestionado) as gestionados,
    count(*) filter (where not es_entrega and not es_gestionado) as sin_resolver
  from base
  group by 1
)
select coalesce(jsonb_agg(jsonb_build_object(
  'cadete', a.cadete,
  'localidades', coalesce(la.localidades, '{}'::jsonb),
  'asignados', a.asignados,
  'entregados', a.entregados,
  'pendientes', a.pendientes,
  'gestionados', a.gestionados,
  'sin_resolver', a.sin_resolver,
  'min_entre_entregas', r.min_entre_entregas,
  'hora_primera_entrega', pe.hora_primera_entrega,
  'hora_ultima_actividad', ua.hora_ultima_actividad,
  'entregados_pre21', coalesce(p21.entregados_pre21, 0)
)), '[]'::jsonb)
from agg a
left join localidades_agg la on la.cadete = a.cadete
left join ritmo r on r.cadete = a.cadete
left join primera_entrega pe on pe.cadete = a.cadete
left join ultima_actividad ua on ua.cadete = a.cadete
left join pre21 p21 on p21.cadete = a.cadete;
$function$;

-- Dashboard de Envíos (resumen_envios): antes `where fecha_mercadopacks
-- between fecha_desde and fecha_hasta` (inclusive hasta medianoche exacta
-- de fecha_hasta); ahora rango [fecha_desde 00:00 ART, fecha_hasta+1 00:00
-- ART), para incluir TODO el día fecha_hasta y no solo su medianoche.
create or replace function public.resumen_envios(fecha_desde date, fecha_hasta date)
 returns jsonb
 language sql
 stable
as $function$
with base as (
  select
    estado,
    coalesce(nullif(zona, ''), 'Sin zona') as zona_norm,
    cadete,
    (estado in ('Entregado', 'Entregado 2DA visita')) as es_entrega_efectiva,
    (estado in ('Cancelado', 'Rechazado por el comprador')) as es_cancelado,
    (estado = 'A retirar') as es_a_retirar,
    (cadete is not null and cadete <> '') as tiene_chofer,
    (origen in ('ML', 'ML TURBO')) as es_flex,
    extract(hour from fecha_estado at time zone 'America/Argentina/Buenos_Aires')::int as hora_art
  from public.envios
  where fecha_mercadopacks >= (fecha_desde::timestamp at time zone 'America/Argentina/Buenos_Aires')
    and fecha_mercadopacks < ((fecha_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
),
con_hora as (
  select *,
    case
      when hora_art is null then null
      when hora_art < 21 then 'antes21'
      when hora_art = 21 then 'e21_22'
      when hora_art = 22 then 'e22_23'
      else 'despues23'
    end as bucket_hora
  from base
),
resumen as (
  select
    count(*) as total,
    count(*) filter (where es_entrega_efectiva) as entregas_efectivas,
    count(*) filter (where es_cancelado) as cancelados,
    count(*) filter (where es_a_retirar) as a_retirar,
    count(*) filter (where es_flex) as total_flex,
    count(*) filter (where es_flex and es_a_retirar) as a_retirar_flex
  from con_hora
),
por_zona as (
  select zona_norm as zona,
    count(*) as total,
    count(*) filter (where es_entrega_efectiva) as entregas_efectivas,
    count(*) filter (where es_cancelado) as cancelados,
    count(*) filter (where es_a_retirar) as a_retirar,
    count(*) filter (where es_entrega_efectiva and bucket_hora = 'antes21') as antes_de_corte
  from con_hora
  group by 1
  order by total desc
),
por_chofer as (
  select cadete,
    count(*) as total_asignados,
    count(*) filter (where es_entrega_efectiva) as entregas_efectivas,
    count(*) filter (where es_cancelado) as cancelados,
    count(*) filter (where es_a_retirar) as a_retirar,
    count(*) filter (where es_entrega_efectiva and bucket_hora = 'antes21') as antes_de_corte
  from con_hora
  where tiene_chofer
  group by 1
  order by 2 desc
),
sin_chofer as (
  select count(*) as total from con_hora where not tiene_chofer
),
por_estado_hora as (
  select estado,
    count(*) filter (where bucket_hora = 'antes21') as antes21,
    count(*) filter (where bucket_hora = 'e21_22') as e21_22,
    count(*) filter (where bucket_hora = 'e22_23') as e22_23,
    count(*) filter (where bucket_hora = 'despues23') as despues23
  from con_hora
  where bucket_hora is not null
  group by 1
),
por_estado_hora_flex as (
  select estado,
    count(*) filter (where bucket_hora = 'antes21') as antes21,
    count(*) filter (where bucket_hora = 'e21_22') as e21_22,
    count(*) filter (where bucket_hora = 'e22_23') as e22_23,
    count(*) filter (where bucket_hora = 'despues23') as despues23
  from con_hora
  where bucket_hora is not null and es_flex
  group by 1
),
por_hora as (
  select hora_art as hora, count(*) as cantidad
  from con_hora
  where es_entrega_efectiva and hora_art is not null
  group by 1
)
select jsonb_build_object(
  'resumen', (select to_jsonb(r) from resumen r),
  'por_zona', (select coalesce(jsonb_agg(to_jsonb(z)), '[]'::jsonb) from por_zona z),
  'por_chofer', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from por_chofer c),
  'sin_chofer_total', (select total from sin_chofer),
  'por_estado_hora', (select coalesce(jsonb_object_agg(estado, jsonb_build_object('antes21',antes21,'e21_22',e21_22,'e22_23',e22_23,'despues23',despues23)), '{}'::jsonb) from por_estado_hora),
  'por_estado_hora_flex', (select coalesce(jsonb_object_agg(estado, jsonb_build_object('antes21',antes21,'e21_22',e21_22,'e22_23',e22_23,'despues23',despues23)), '{}'::jsonb) from por_estado_hora_flex),
  'por_hora', (select coalesce(jsonb_object_agg(hora::text, cantidad), '{}'::jsonb) from por_hora)
);
$function$;

notify pgrst, 'reload schema';
