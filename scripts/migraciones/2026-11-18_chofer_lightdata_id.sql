-- Cruzar repartidores por ID de Lightdata en vez de por nombre (pedido
-- 2026-11-18, ver lightdata_api_envios.md en la raíz del repo). El export
-- de envíos trae `didcadete` (ID del repartidor), el mismo ID que
-- lightdata_usuarios.lightdata_id — ya no hace falta adivinar por texto.
--
-- Sin FK estricta a propósito: si vincular_choferes_envios.py corre antes
-- de que sincronizar_lightdata.py haya traído a ese repartidor en
-- particular, no debe romper la publicación de envíos (que es lo
-- prioritario). Solo un entero + índice para el join.

alter table public.envios
  add column if not exists chofer_lightdata_id integer;

create index if not exists envios_chofer_lightdata_id_idx
  on public.envios (chofer_lightdata_id);

-- Mismo criterio del lado de Asistencia: se copia del roster al cargar un
-- repartidor para un día (tanto "Agregar repartidor" como "Cargar
-- repartidores de mañana"), para no depender del nombre tampoco acá.
alter table public.asistencia_diaria
  add column if not exists lightdata_id integer;

create index if not exists asistencia_diaria_lightdata_id_idx
  on public.asistencia_diaria (lightdata_id);
