-- Fix: resumen_envios() quedó referenciando raw->>'Origen', columna que
-- se borró en el rediseño de envios (ver 2026-11-19e_drop_raw.sql). Rompía
-- el Dashboard de Envíos ("Error cargando los datos."). Se cambia a la
-- columna propia `origen`.

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
  where fecha_mercadopacks between fecha_desde and fecha_hasta
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
$function$
