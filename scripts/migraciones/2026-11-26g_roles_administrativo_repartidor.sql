-- Pedido 2026-11-26: parametrizar las vistas por 4 roles reales
-- (Administrador, Administrativo, Cliente, Repartidor) en vez de solo
-- "Cliente sí/no" — "hay cosas que no deberían tocar a menos que seas
-- administrador". Se agrega "repartidor" como tipo_usuario válido (antes
-- solo existían 'administrativo'/'cliente'; "Administrador" sigue siendo
-- el flag `es_admin` ya existente, que bypasea cualquier restricción —
-- no se duplica esa semántica en tipo_usuario) y se suman 2 columnas a
-- parametros_vistas para poder configurar, por separado, si una vista es
-- asignable a un Administrativo o a un Repartidor (ya existía la de
-- Cliente).

alter table public.perfiles_usuario drop constraint if exists perfiles_usuario_tipo_usuario_check;
alter table public.perfiles_usuario add constraint perfiles_usuario_tipo_usuario_check
  check (tipo_usuario in ('administrativo', 'cliente', 'repartidor'));

alter table public.parametros_vistas
  add column if not exists visible_para_administrativos boolean not null default true,
  add column if not exists visible_para_repartidores boolean not null default false;

-- "Administración" (Configuración completa: Usuarios, Liquidaciones
-- Vinculadas, grants, etc.) queda admin-only por default — un
-- Administrativo común no debería poder tocarla salvo que el usuario lo
-- habilite a mano desde Configuración → Vistas. El resto de las vistas
-- operativas (Envíos, Liquidaciones, Seguimiento) sigue abierta a
-- Administrativo (default true de la columna nueva), que es como ya
-- funcionaba antes de este cambio.
update public.parametros_vistas set visible_para_administrativos = false where clave = 'admin';

notify pgrst, 'reload schema';
