-- Paso 2 de 2 (ver 2026-11-19d_columnas_desde_raw.sql): borra `raw` de
-- `envios` recién ahora que el backfill de las 24.849 filas existentes
-- quedó confirmado 100% completo (ver reglas_de_negocio.md changelog) —
-- todo lo que tenía adentro ya está en columnas propias o en
-- envios_contacto_destinatario. `publicar_supabase.py` ya dejó de
-- escribirla desde la migración anterior.
--
-- Correr ESTO SOLO después de confirmar con una consulta tipo:
--   select count(*) from envios where origen is null;
-- que da 0 (o un número chico y explicado, ej. envíos sin ese dato en el
-- Excel original).

alter table public.envios drop column if exists raw;
