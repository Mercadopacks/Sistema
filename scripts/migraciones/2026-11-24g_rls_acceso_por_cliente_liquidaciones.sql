-- Pedido 2026-11-24 (auditoría de arquitectura, de cara a sumar usuarios
-- tipo Cliente reales): 3 tablas quedaron con SELECT abierto a cualquier
-- autenticado (`qual=true`) en vez de filtrar por el/los cliente(s)
-- vinculados al usuario logueado — a diferencia de `envios`/
-- `envios_contacto_destinatario`, que ya usan el patrón correcto
-- (`puede_ver_envio_de_cliente()`, ver 2026-11-20_tipo_usuario_y_acceso_
-- por_cliente.sql). Se reusa esa misma función (ya genérica, no específica
-- de envíos) para liquidaciones_clientes, liquidacion_extras_clientes y
-- clientes_colectas — mismo criterio de "fail-open si todavía no tiene
-- perfil", no se cambia esa decisión ya documentada.

drop policy if exists "liquidaciones_clientes select" on public.liquidaciones_clientes;
create policy "liquidaciones_clientes select" on public.liquidaciones_clientes
  for select to authenticated using (public.puede_ver_envio_de_cliente(did_cliente));

drop policy if exists "liquidacion_extras_clientes select" on public.liquidacion_extras_clientes;
create policy "liquidacion_extras_clientes select" on public.liquidacion_extras_clientes
  for select to authenticated using (public.puede_ver_envio_de_cliente(did_cliente));

drop policy if exists "clientes_colectas select" on public.clientes_colectas;
create policy "clientes_colectas select" on public.clientes_colectas
  for select to authenticated using (public.puede_ver_envio_de_cliente(did_cliente));

notify pgrst, 'reload schema';
