-- Fallidos y Cambios tarda varios segundos en cargar. Medido con la
-- service role key (ver reglas_de_negocio.md, changelog 2026-11-18):
-- la consulta por señal de Cambio (`observaciones.ilike.%cambio%`) sola
-- tarda ~2.3s porque un ILIKE con comodín al principio no puede usar un
-- índice normal — hace un escaneo completo de la tabla `envios`. Estos
-- índices la aceleran; el fix de que las 3 consultas corran en paralelo
-- (en vez de una por una) va en index.html, no acá.

create extension if not exists pg_trgm;

-- Acelera observaciones.ilike.'%cambio%' (y cualquier búsqueda de texto
-- libre futura sobre esta columna).
create index if not exists envios_observaciones_trgm_idx
  on public.envios using gin (observaciones gin_trgm_ops);

-- Acelera el filtro .gte("fecha_mercadopacks", cutoff) que usan las dos
-- consultas de Fallidos (y varias otras pantallas del dashboard).
create index if not exists envios_fecha_mercadopacks_idx
  on public.envios (fecha_mercadopacks);

-- Acelera el filtro .in("estado", estados) de la consulta de Fallidos
-- "clásicos" (por Estado mapeado).
create index if not exists envios_estado_idx
  on public.envios (estado);

-- Índice parcial (solo las filas que importan acá) para la otra mitad del
-- OR de la consulta de señal de Cambio: logistica_inversa.not.is.null.
create index if not exists envios_logistica_inversa_not_null_idx
  on public.envios (id_interno) where logistica_inversa is not null;
