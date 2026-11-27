-- Pedido 2026-11-27: la tarjeta de Fulfillment separa "Despacho Unitario"
-- en 2 conceptos -- "Armado (Última Milla)" (cantidad automática, igual
-- que antes) y "Armado (Correo)" (cantidad cargada a mano, porque
-- Lightdata hoy no informa envíos despachados por Correo). Se necesita
-- una columna propia para persistir esa cantidad por período (mismo
-- criterio que cantidad_pallets).
alter table public.liquidaciones_clientes
  add column if not exists cantidad_despacho_correo numeric not null default 0;

-- Sin grant nuevo: ALTER TABLE ADD COLUMN hereda los grants de tabla ya
-- existentes (liquidaciones_clientes.* a authenticated/service_role, ver
-- 2026-11-23f_motor_liquidacion_clientes.sql) -- un grant de columna
-- puntual solo hace falta si se quisiera RESTRINGIR esta columna
-- respecto del resto, que no es el caso.

notify pgrst, 'reload schema';
