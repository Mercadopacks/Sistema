-- Pedido 2026-11-24 (continuación de la auditoría RLS): INSERT/UPDATE/
-- DELETE de liquidaciones_clientes, liquidacion_extras_clientes y
-- clientes_colectas quedaban abiertos a cualquier autenticado — hoy solo
-- el personal administrativo escribe ahí desde la UI, pero de cara a
-- sumar cuentas de Cliente reales, se restringe a `tiene_permiso_vista
-- ('admin')`, mismo criterio ya usado en precios_cliente. El SELECT no se
-- toca (ya quedó filtrado por cliente en la migración anterior).

drop policy if exists "liquidaciones_clientes insert" on public.liquidaciones_clientes;
drop policy if exists "liquidaciones_clientes update" on public.liquidaciones_clientes;
drop policy if exists "liquidaciones_clientes delete" on public.liquidaciones_clientes;
create policy "liquidaciones_clientes insert" on public.liquidaciones_clientes
  for insert to authenticated with check (public.tiene_permiso_vista('admin'));
create policy "liquidaciones_clientes update" on public.liquidaciones_clientes
  for update to authenticated using (public.tiene_permiso_vista('admin')) with check (public.tiene_permiso_vista('admin'));
create policy "liquidaciones_clientes delete" on public.liquidaciones_clientes
  for delete to authenticated using (public.tiene_permiso_vista('admin'));

drop policy if exists "liquidacion_extras_clientes insert" on public.liquidacion_extras_clientes;
drop policy if exists "liquidacion_extras_clientes update" on public.liquidacion_extras_clientes;
drop policy if exists "liquidacion_extras_clientes delete" on public.liquidacion_extras_clientes;
create policy "liquidacion_extras_clientes insert" on public.liquidacion_extras_clientes
  for insert to authenticated with check (public.tiene_permiso_vista('admin'));
create policy "liquidacion_extras_clientes update" on public.liquidacion_extras_clientes
  for update to authenticated using (public.tiene_permiso_vista('admin')) with check (public.tiene_permiso_vista('admin'));
create policy "liquidacion_extras_clientes delete" on public.liquidacion_extras_clientes
  for delete to authenticated using (public.tiene_permiso_vista('admin'));

drop policy if exists "clientes_colectas insert" on public.clientes_colectas;
drop policy if exists "clientes_colectas update" on public.clientes_colectas;
drop policy if exists "clientes_colectas delete" on public.clientes_colectas;
create policy "clientes_colectas insert" on public.clientes_colectas
  for insert to authenticated with check (public.tiene_permiso_vista('admin'));
create policy "clientes_colectas update" on public.clientes_colectas
  for update to authenticated using (public.tiene_permiso_vista('admin')) with check (public.tiene_permiso_vista('admin'));
create policy "clientes_colectas delete" on public.clientes_colectas
  for delete to authenticated using (public.tiene_permiso_vista('admin'));

notify pgrst, 'reload schema';
