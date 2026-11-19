-- Fallidos y Cambios necesita la dirección del envío (localidad sola no
-- alcanza para identificar el paquete en la calle, pedido del usuario
-- 2026-11-19) — pero `envios_contacto_destinatario` quedó deliberadamente
-- cerrada en el rediseño (migración 2026-11-19d: sin policy para
-- `authenticated`, por ser datos sensibles del destinatario). En vez de
-- abrirla del todo, se agrega una policy de SOLO LECTURA acotada a
-- usuarios con la vista "fallidos" (misma función tiene_permiso_vista()
-- que ya usan las demás tablas, ver migración 2026-11-19_auditoria_arquitectura.sql).
-- Sigue sin acceso para cualquier otro usuario autenticado sin esa vista,
-- y sin INSERT/UPDATE/DELETE desde el frontend (eso sigue siendo
-- exclusivo de service_role, vía publicar_supabase.py).

grant select on public.envios_contacto_destinatario to authenticated;

create policy "fallidos leen direccion de destinatario"
on public.envios_contacto_destinatario
for select
to authenticated
using (public.tiene_permiso_vista('fallidos'));
