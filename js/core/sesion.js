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
  // "repartidor" (pedido 2026-11-26): 4to rol — igual que administrativo/
  // cliente, su acceso a cada vista se configura en parametros_vistas
  // (Configuración → Vistas). "Administrador" NO es un valor de
  // tipo_usuario — sigue siendo el flag `es_admin` (perfiles_usuario),
  // que bypasea cualquier restricción de vistas sin importar el
  // tipo_usuario — ver vistasValidasPara() en js/admin/usuarios.js.
  export const TIPOS_USUARIO_OPCIONES = [
    { valor: "administrativo", texto: "Administrativo" },
    { valor: "cliente", texto: "Cliente" },
    { valor: "repartidor", texto: "Repartidor" },
  ];

  // Pedido 2026-11-26: qué vistas son asignables a un usuario tipo
  // "cliente" YA NO vive hardcodeado acá (los flags `soloAdmin`/
  // `paraCliente` de antes) — se equivocó 2 veces (Liquidación
  // Consolidada quedó marcada soloAdmin por copiar sin pensar el patrón
  // de Liquidación Clientes, pisando el acceso que el propio módulo
  // necesita). Esa decisión pasó a la tabla `parametros_vistas`
  // (editable desde Configuración → Vistas, ver js/admin/parametros-
  // vistas.js) para que el usuario la pueda cambiar él mismo sin
  // depender de que el código lo recuerde bien. Este array acá solo
  // declara QUÉ vistas existen (clave + label) — ya no decide quién
  // puede verlas.
  export const VISTAS_DISPONIBLES = [
    { clave: "mis-liquidaciones", label: "Mis Liquidaciones" },
    { clave: "envios", label: "Dashboard de Envíos" },
    { clave: "envios-listado", label: "Envíos" },
    { clave: "fallidos", label: "Fallidos y Cambios" },
    { clave: "picking-tamanos", label: "Picking Tamaños" },
    { clave: "repa-ruta", label: "Seguimiento en Ruta" },
    { clave: "repa-asistencia", label: "Asistencia de Repartidores" },
    { clave: "repa-vivo", label: "Operación en vivo" },
    { clave: "liquidacion-clientes", label: "Liquidación Clientes" },
    { clave: "liquidacion-repartidores", label: "Liquidación Repartidores" },
    { clave: "liquidacion-consolidada", label: "Liquidación Consolidada" },
    // Pedido 2026-11-23: 2 vistas separadas a propósito (no una con
    // selector adentro) — son 2 sectores distintos los que cargan extras
    // de clientes vs. de repartidores y no pueden entrar al mismo panel;
    // separarlas como vistas permite que "Vistas permitidas" (Usuarios)
    // le dé acceso a una sin la otra.
    { clave: "extras-liquidacion-clientes", label: "Adicionales (Clientes)" },
    { clave: "extras-liquidacion-repartidores", label: "Adicionales (Repartidores)" },
    { clave: "admin", label: "Configuración" },
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
  // Pedido 2026-11-27: el indicador de "quién está logueado" del header
  // pasa a mostrar nombre y apellido (perfiles_usuario) en vez del email
  // — el email queda de fallback mientras el perfil todavía no terminó
  // de cargar, o si por algún motivo no se encontró. Exportada (no vive
  // solo en index.html) para que usuarios.js también la pueda llamar
  // cuando el usuario logueado se edita a sí mismo.
  export function actualizarIndicadorUsuario(emailFallback){
    const el = document.getElementById("usuario-email");
    if(!el) return;
    const p = stateSesion.perfil;
    const nombreCompleto = p ? `${p.nombre || ""} ${p.apellido || ""}`.trim() : "";
    el.textContent = nombreCompleto || emailFallback || "—";
  }

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
