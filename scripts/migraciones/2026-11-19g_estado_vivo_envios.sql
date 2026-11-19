-- Fix de fondo: envios.estado solo se refrescaba con la publicación de
-- Excel (publicar_supabase.py), no con el ciclo en vivo de cada 10 min
-- (vincular_choferes_envios.py) — ese script ya pedía `estado_envio` al
-- endpoint de Lightdata pero nunca lo guardaba. Un envío podía figurar
-- "No Entregado" en Fallidos durante horas después de que Lightdata ya
-- lo marcara "Entregado"/"Devuelto al cliente" (caso real: tracking
-- 48514057705). Se agrega `estado` al RPC que actualiza en vivo.

create or replace function public.actualizar_envio_lightdata_vivo_lote(filas jsonb)
returns void
language sql
as $$
  update public.envios e set
    chofer_lightdata_id = coalesce(x.chofer_lightdata_id, e.chofer_lightdata_id),
    logistica_inversa_real = x.logistica_inversa_real,
    estado = coalesce(x.estado, e.estado),
    estado_ml = x.estado_ml,
    did_cliente = x.did_cliente
  from jsonb_to_recordset(filas) as x(
    id_interno text, chofer_lightdata_id integer, logistica_inversa_real boolean,
    estado text, estado_ml text, did_cliente integer
  )
  where e.id_interno = x.id_interno;
$$;

revoke execute on function public.actualizar_envio_lightdata_vivo_lote(jsonb) from public, anon, authenticated;
grant execute on function public.actualizar_envio_lightdata_vivo_lote(jsonb) to service_role;
