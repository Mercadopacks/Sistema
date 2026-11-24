-- Pedido 2026-11-23 (3ra vuelta): poder anular una liquidación ya
-- generada (por error) y volver a generarla — se agrega el estado
-- "anulada". Una anulada deja de contar como "ya liquidada" (la pantalla
-- vuelve a ofrecerla como pendiente para ese período), consistente con
-- el chequeo que ya hacía el resto del sistema (solo mira estado =
-- 'generada' para considerar un período cerrado).
alter table public.liquidaciones_clientes drop constraint if exists liquidaciones_clientes_estado_check;
alter table public.liquidaciones_clientes add constraint liquidaciones_clientes_estado_check
  check (estado in ('borrador', 'generada', 'anulada'));

notify pgrst, 'reload schema';
