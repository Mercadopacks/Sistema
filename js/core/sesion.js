// Sesión y permisos por vista: tipos de usuario, lista cerrada de vistas
// (VISTAS_DISPONIBLES, la usa "Vistas permitidas" de Usuarios), estado de la
// sesión (perfil del usuario logueado) y filtro del sidebar por permisos.
// Viene de index.html (Etapa 5b de migración a ES Modules, 2026-11-25).
// `stateSesion` es un objeto exportado (no un `let`): index.html (login) y
// Usuarios (edición del propio perfil) reasignan sus propiedades, nunca el binding.
// Las menciones "más abajo" / "ver cargarPerfilSesion()" de los comentarios de
// abajo apuntan a index.html.

  // Claves válidas = keys del objeto `vistas` (ver más abajo). Debe
  // mantenerse sincronizado a mano si se agrega una vista nueva — no hay
  // forma de derivarlo antes de que `vistas` exista en el script.
  // tipo_usuario (pedido 2026-11-20, reemplaza el "sector" de texto libre):
  // "cliente" ve solo su propia información (acotado por RLS vía
  // clientes_lightdata_ids, ver migración 2026-11-20_tipo_usuario_y_acceso_por_cliente.sql),
  // "administrativo" es personal de la empresa y usa un sector de la
  // lista cerrada parametros_sectores en vez de texto libre.
  export const TIPOS_USUARIO_OPCIONES = [
    { valor: "administrativo", texto: "Administrativo" },
    { valor: "cliente", texto: "Cliente" },
  ];

  // `paraCliente: true` marca la(s) vista(s) pensadas para tipo_usuario=
  // "cliente" (hoy solo Mis Liquidaciones) — no tiene sentido ofrecérsela
  // a un usuario administrativo. `soloAdmin: true` marca las vistas que
  // manejan datos de MÁS DE UN cliente/repartidor o permiten escritura
  // administrativa (Configuración completa, Liquidación Clientes/
  // Repartidores con edición, sus Adicionales) — nunca se le deben poder
  // asignar a un usuario tipo "cliente", sin importar qué tilde un admin
  // por error en "Vistas permitidas" de Usuarios. El resto de las vistas
  // (Envíos, Fallidos, Picking, Seguimiento de Repartidores) quedan
  // libres para cualquier tipo de usuario — ya están acotadas por RLS a
  // nivel de fila (ver puede_ver_envio_de_cliente()), así que no hace
  // falta bloquearlas acá también (pedido 2026-11-25, 2da vuelta: la
  // primera versión de este filtro bloqueaba TODO lo que no fuera
  // paraCliente, lo cual también tapaba vistas inofensivas como Envíos).
  export const VISTAS_DISPONIBLES = [
    { clave: "mis-liquidaciones", label: "Mis Liquidaciones", paraCliente: true },
    { clave: "envios", label: "Dashboard de Envíos" },
    { clave: "envios-listado", label: "Envíos" },
    { clave: "fallidos", label: "Fallidos y Cambios" },
    { clave: "picking-tamanos", label: "Picking Tamaños" },
    { clave: "repa-ruta", label: "Seguimiento en Ruta" },
    { clave: "repa-asistencia", label: "Asistencia de Repartidores" },
    { clave: "repa-vivo", label: "Operación en vivo" },
    { clave: "liquidacion-clientes", label: "Liquidación Clientes", soloAdmin: true },
    { clave: "liquidacion-repartidores", label: "Liquidación Repartidores", soloAdmin: true },
    // Pedido 2026-11-23: 2 vistas separadas a propósito (no una con
    // selector adentro) — son 2 sectores distintos los que cargan extras
    // de clientes vs. de repartidores y no pueden entrar al mismo panel;
    // separarlas como vistas permite que "Vistas permitidas" (Usuarios)
    // le dé acceso a una sin la otra.
    { clave: "extras-liquidacion-clientes", label: "Adicionales (Clientes)", soloAdmin: true },
    { clave: "extras-liquidacion-repartidores", label: "Adicionales (Repartidores)", soloAdmin: true },
    { clave: "admin", label: "Administración", soloAdmin: true },
  ];

  export const stateSesion = { perfil: null, bloqueado: false };

  export function puedeVerVista(clave){
    const p = stateSesion.perfil;
    if(!p) return true; // sin perfil todavía = fail-open, ver cargarPerfilSesion()
    if(p.es_admin) return true;
    return (p.vistas_permitidas || []).includes(clave);
  }

  // Oculta del sidebar los nav-item/nav-subitem cuya vista no está
  // permitida. Solo esconde el botón — no hay routing por hash en este
  // sistema, así que no hace falta bloquear nada más aparte de esto.
  export function aplicarPermisosVistas(){
    document.querySelectorAll("[data-vista]").forEach(btn=>{
      btn.hidden = !puedeVerVista(btn.dataset.vista);
    });
    // Bug real 2026-11-25: esto solo escondía el encabezado del PRIMER
    // grupo del sidebar ("Seguimiento de Repartidores", hardcodeado) — el
    // de "Liquidaciones" nunca se ocultaba, así que un usuario tipo
    // cliente (sin acceso a ninguna vista de ese grupo) veía el título
    // "Liquidaciones" vacío, sin nada debajo. Se generaliza a CUALQUIER
    // .nav-group: se esconde su encabezado si ninguno de sus
    // [data-vista] internos quedó visible tras el filtro de arriba.
    document.querySelectorAll(".nav-group").forEach(grupoEl=>{
      const label = grupoEl.querySelector(".nav-group-label");
      if(!label) return;
      const algunaVisible = [...grupoEl.querySelectorAll("[data-vista]")].some(b => !b.hidden);
      label.hidden = !algunaVisible;
    });
  }
