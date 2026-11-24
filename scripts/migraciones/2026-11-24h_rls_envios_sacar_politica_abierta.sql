-- Pedido 2026-11-24 (continuación de la auditoría): `envios` tenía 2
-- políticas de SELECT activas a la vez: la restrictiva por cliente
-- (`puede_ver_envio_de_cliente`, 2026-11-20) y una vieja abierta a
-- cualquier autenticado ("autenticados pueden leer envios", qual=true).
-- Postgres une políticas permisivas del mismo comando con OR, así que la
-- abierta ganaba igual y la restrictiva no hacía nada en la práctica — el
-- mismo problema recién corregido en liquidaciones_clientes/
-- liquidacion_extras_clientes/clientes_colectas, pero en la tabla más
-- sensible del sistema. Se elimina la política abierta; queda solo la
-- restrictiva por cliente (admin sigue viendo todo vía esa misma función,
-- ver su definición: `tipo_usuario <> 'cliente'` ve todo).

drop policy if exists "autenticados pueden leer envios" on public.envios;

notify pgrst, 'reload schema';
