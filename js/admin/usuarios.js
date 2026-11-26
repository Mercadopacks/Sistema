// Configuración > Usuarios: alta (Edge Function crear-usuario), edición y
// permisos por vista de perfiles_usuario — tipo "administrativo" (sector) o
// "cliente" (clientes de Lightdata asociados).
// Viene de index.html (Etapa 5c de migración a ES Modules, 2026-11-25).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../core/supabase.js";
import { mostrarAviso } from "../ui/dialogos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";
import { catalogos, labelCliente } from "../core/catalogos.js";
import { TIPOS_USUARIO_OPCIONES, VISTAS_DISPONIBLES, stateSesion, aplicarPermisosVistas } from "../core/sesion.js";

  // ======================================================================
  // Administración > Usuarios (alta + permisos por vista, 2026-11-16)
  // ======================================================================
  let adminUsuariosData = [];
  let adminUsuariosBusqueda = "";
  // Listas cerradas usadas por el ABM de Usuarios (pedido 2026-11-20):
  // sectores (para tipo_usuario="administrativo") y clientes de Lightdata
  // (para tipo_usuario="cliente", ver docs/lightdata_api_clientes.md y
  // migración 2026-11-20_tipo_usuario_y_acceso_por_cliente.sql). Se
  // cargan junto con los usuarios porque el modal de alta/edición las
  // necesita ya resueltas (combo/multiselect) antes de abrirse.
  let sectoresDisponibles = [];   // [{id, nombre}]
  // clientes: viven en catalogos.clientes (js/core/catalogos.js, Etapa 4b), compartidos con Envíos y Adicionales.

  function didsClienteALabel(dids){
    return (dids || []).map(d => { const c = catalogos.clientes.find(x => x.did === d); return c ? labelCliente(c) : null; }).filter(Boolean);
  }
  function labelsClienteADid(labels){
    return (labels || []).map(l => { const c = catalogos.clientes.find(x => labelCliente(x) === l); return c ? c.did : null; }).filter(d => d != null);
  }

  // Convierte la lista de claves guardadas (ej. ["envios","fallidos"]) a
  // los labels legibles que usa el combo multiselect del modal, y
  // viceversa — el campo "multiselect" del modal genérico trabaja con
  // strings (el label es también el value), no con pares {clave,label}
  // como el campo "select", así que la conversión se hace acá en vez de
  // tocar ese componente compartido.
  function clavesAVistasLabel(claves){
    return (claves || []).map(c => (VISTAS_DISPONIBLES.find(v => v.clave === c) || {}).label).filter(Boolean);
  }
  function labelsAVistasClave(labels){
    return (labels || []).map(l => (VISTAS_DISPONIBLES.find(v => v.label === l) || {}).clave).filter(Boolean);
  }
  // Pedido 2026-11-25: el multiselect de "Vistas permitidas" ofrece TODAS
  // las vistas sin filtrar por el Tipo de usuario elegido en el mismo
  // modal (el componente de ABM no soporta opciones dinámicas según otro
  // campo) — antes nada impedía guardar una vista de personal
  // administrativo (ej. "Liquidación Clientes" completa, con edición)
  // para un usuario tipo "Cliente". Se filtra acá al guardar, no en el
  // multiselect.
  // Pedido 2026-11-26: qué vistas son asignables a cada rol (Cliente,
  // Administrativo, Repartidor) YA NO es un flag hardcodeado en el
  // código (se equivocó 2 veces) — sale de parametros_vistas, editable
  // desde Configuración → Vistas. "Administrador" (es_admin=true) sigue
  // sin filtro, nunca se restringe — es el 4to rol que pidió el usuario,
  // pero vive en el flag `es_admin` existente, no en tipo_usuario.
  let configVistas = new Map(); // clave -> { clientes, administrativos, repartidores }
  async function cargarConfigVistas(forzar){
    if(configVistas.size && !forzar) return;
    const { data, error } = await sb.from("parametros_vistas").select("clave,visible_para_clientes,visible_para_administrativos,visible_para_repartidores");
    if(error){ console.error("Error cargando parametros_vistas:", error); return; }
    configVistas = new Map((data || []).map(v => [v.clave, {
      clientes: v.visible_para_clientes, administrativos: v.visible_para_administrativos, repartidores: v.visible_para_repartidores,
    }]));
  }
  function vistaValidaParaRol(tipoUsuario, clave){
    const campo = tipoUsuario === "cliente" ? "clientes" : tipoUsuario === "repartidor" ? "repartidores" : "administrativos";
    const fila = configVistas.get(clave);
    // Fail-open si parametros_vistas todavía no tiene esa clave (vista
    // nueva recién agregada al código, sin fila sembrada todavía) —
    // mismo criterio del resto del sistema de permisos.
    return fila ? !!fila[campo] : true;
  }
  function vistasValidasPara(tipoUsuario, esAdmin, claves){
    return (claves || []).filter(c => {
      if(!VISTAS_DISPONIBLES.some(x => x.clave === c)) return false;
      if(esAdmin) return true; // Administrador: nunca se filtra
      return vistaValidaParaRol(tipoUsuario, c);
    });
  }
  // Pedido 2026-11-26: el multiselect de "Vistas permitidas" pasa a
  // mostrar SOLO las vistas válidas para el "Tipo de usuario" elegido en
  // el mismo modal (bug real reportado: con un Cliente seleccionado,
  // mostraba el catálogo completo igual que para un Administrativo, y el
  // filtro recién se notaba al guardar).
  function opcionesVistasSegunTipo(valoresActuales){
    const tipo = (valoresActuales && valoresActuales.tipo_usuario) || "administrativo";
    return VISTAS_DISPONIBLES.filter(v => vistaValidaParaRol(tipo, v.clave)).map(v => v.label);
  }

  export async function cargarAdminUsuarios(){
    const [{ data, error }, { data: sectores, error: errSectores }, { data: clientes, error: errClientes }] = await Promise.all([
      sb.from("perfiles_usuario").select("*").order("nombre"),
      sb.from("parametros_sectores").select("id,nombre").eq("activo", true).order("nombre"),
      sb.from("lightdata_clientes").select("did,codigo,nombre_fantasia").eq("habilitado", true).order("nombre_fantasia"),
    ]);
    if(error){ console.error("Error cargando perfiles_usuario:", error); return; }
    if(errSectores) console.error("Error cargando parametros_sectores:", errSectores);
    if(errClientes) console.error("Error cargando lightdata_clientes:", errClientes);
    adminUsuariosData = data || [];
    sectoresDisponibles = sectores || [];
    catalogos.clientes = clientes || [];
    await cargarConfigVistas();
    renderAdminUsuarios();
  }

  // Texto de la columna "Tipo" / búsqueda — sector por nombre si es
  // administrativo, clientes asociados si es cliente (mismo criterio que
  // el detalle, ver abrirDetalleUsuario).
  function descripcionTipoUsuario(u){
    if(u.tipo_usuario === "cliente"){
      const nombres = didsClienteALabel(u.clientes_lightdata_ids);
      return nombres.length ? `Cliente: ${nombres.join(", ")}` : "Cliente (sin asociar)";
    }
    if(u.tipo_usuario === "repartidor") return "Repartidor";
    const sector = sectoresDisponibles.find(s => s.id === u.sector_id);
    return sector ? `Administrativo: ${sector.nombre}` : "Administrativo";
  }

  function renderAdminUsuarios(){
    const q = adminUsuariosBusqueda;
    let filas = adminUsuariosData;
    if(q){
      filas = filas.filter(u =>
        (u.nombre || "").toLowerCase().includes(q) ||
        (u.apellido || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        descripcionTipoUsuario(u).toLowerCase().includes(q)
      );
    }
    const tbody = document.getElementById("tabla-admin-usuarios");
    if(!filas.length){
      tbody.innerHTML = `<tr><td colspan="7" class="sin-datos">Sin usuarios cargados.</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(u => `
      <tr data-id="${u.id}">
        <td>${u.nombre}</td>
        <td>${u.apellido}</td>
        <td>${u.email}</td>
        <td class="texto-muted">${descripcionTipoUsuario(u)}</td>
        <td>${u.es_admin ? '<span class="badge verde">Sí</span>' : '<span class="badge gris">No</span>'}</td>
        <td>${u.activo ? '<span class="badge verde">Sí</span>' : '<span class="badge rojo">No</span>'}</td>
        <td class="col-opciones">
          <span class="opciones-fila">
            <button type="button" class="btn-icono-chico ver" data-id="${u.id}" title="Ver detalle"><i data-lucide="eye"></i></button>
            <button type="button" class="btn-icono-chico editar" data-id="${u.id}" title="Editar"><i data-lucide="pencil"></i></button>
          </span>
        </td>
      </tr>
    `).join("");
    lucide.createIcons();
  }

  document.getElementById("buscar-admin-usuarios").addEventListener("input", (e)=>{
    adminUsuariosBusqueda = e.target.value.trim().toLowerCase();
    renderAdminUsuarios();
  });

  function abrirDetalleUsuario(id){
    const u = adminUsuariosData.find(x => String(x.id) === String(id));
    if(!u) return;
    document.getElementById("modal-detalle-usuario-titulo").textContent = `Detalle — ${u.nombre} ${u.apellido}`;
    const esCliente = u.tipo_usuario === "cliente";
    const labelTipo = (TIPOS_USUARIO_OPCIONES.find(t => t.valor === u.tipo_usuario) || {}).texto || u.tipo_usuario;
    const campos = [
      { icono: "mail", label: "Email", valor: u.email },
      { icono: "user-cog", label: "Tipo de usuario", valor: labelTipo },
      esCliente
        ? { icono: "building-2", label: "Clientes asociados", valor: didsClienteALabel(u.clientes_lightdata_ids).join(", ") || "—", span: true }
        : u.tipo_usuario === "administrativo"
          ? { icono: "briefcase", label: "Sector", valor: (sectoresDisponibles.find(s => s.id === u.sector_id) || {}).nombre || "—" }
          : { icono: "truck", label: "Rol", valor: labelTipo },
      { icono: "shield-check", label: "Admin", valor: u.es_admin ? "Sí" : "No" },
      { icono: "check-circle-2", label: "Activo", valor: u.activo ? "Sí" : "No" },
      { icono: "eye", label: "Vistas permitidas", valor: u.es_admin ? "Todas (admin)" : (clavesAVistasLabel(u.vistas_permitidas).join(", ") || "—"), span: true },
    ];
    document.getElementById("modal-detalle-usuario-cuerpo").innerHTML = `
      <div class="grid-detalle-compacto">
        ${campos.map(c => `
          <div class="campo-detalle${c.span ? " campo-span-completo" : ""}">
            <span class="campo-detalle-label"><i data-lucide="${c.icono}"></i>${c.label}</span>
            <span class="campo-detalle-valor">${c.valor}</span>
          </div>
        `).join("")}
      </div>
    `;
    lucide.createIcons();
    document.getElementById("modal-detalle-usuario").hidden = false;
  }
  document.getElementById("modal-detalle-usuario-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-detalle-usuario").hidden = true;
  });
  document.getElementById("modal-detalle-usuario").addEventListener("click", (e)=>{
    if(e.target.id === "modal-detalle-usuario") document.getElementById("modal-detalle-usuario").hidden = true;
  });

  document.getElementById("tabla-admin-usuarios").addEventListener("click", (e)=>{
    const btnVer = e.target.closest(".btn-icono-chico.ver");
    if(btnVer){ abrirDetalleUsuario(btnVer.dataset.id); return; }
    const btn = e.target.closest(".btn-icono-chico.editar");
    if(!btn) return;
    const usuario = adminUsuariosData.find(u => String(u.id) === btn.dataset.id);
    if(!usuario) return;
    abrirModalAbm(`Editar usuario: ${usuario.nombre} ${usuario.apellido}`, [
      { clave: "nombre", label: "Nombre", tipo: "texto" },
      { clave: "apellido", label: "Apellido", tipo: "texto" },
      // Pedido 2026-11-25: cambiar email/contraseña de un usuario ya
      // creado no se puede hacer con un simple `update` de la tabla (son
      // datos de Supabase Auth, no de perfiles_usuario) — requiere la
      // Edge Function editar-usuario (service role), igual que el alta
      // usa crear-usuario. Contraseña vacía = no se cambia.
      { clave: "email", label: "Email", tipo: "texto" },
      { clave: "password", label: "Nueva contraseña (vacío = no cambiarla, mínimo 6 caracteres)", tipo: "texto" },
      { clave: "tipo_usuario", label: "Tipo de usuario", tipo: "select", opciones: TIPOS_USUARIO_OPCIONES },
      {
        clave: "sector_id", label: "Sector", tipo: "select",
        opciones: sectoresDisponibles.map(s => ({ valor: s.id, texto: s.nombre })),
        mostrarSi: v => v.tipo_usuario === "administrativo",
      },
      {
        clave: "clientes", label: "Clientes asociados", tipo: "multiselect", span: true,
        opciones: catalogos.clientes.map(labelCliente),
        mostrarSi: v => v.tipo_usuario === "cliente",
      },
      { clave: "es_admin", label: "Administrador (ve todas las vistas)", tipo: "checkbox" },
      { clave: "activo", label: "Activo (desmarcar bloquea su acceso)", tipo: "checkbox" },
      { clave: "vistas", label: "Vistas permitidas (si no es admin)", tipo: "multiselect", opciones: VISTAS_DISPONIBLES.map(v => v.label), opcionesSegun: opcionesVistasSegunTipo },
    ], {
      ...usuario,
      tipo_usuario: usuario.tipo_usuario || "administrativo",
      vistas: clavesAVistasLabel(usuario.vistas_permitidas).join(", "),
      clientes: didsClienteALabel(usuario.clientes_lightdata_ids).join(", "),
    }, async (vals)=>{
      const esCliente = vals.tipo_usuario === "cliente";
      const clientesIds = labelsClienteADid(String(vals.clientes || "").split(",").map(s => s.trim()).filter(Boolean));
      if(esCliente && !clientesIds.length){
        await mostrarAviso("Un usuario tipo Cliente necesita al menos un cliente asociado.");
        return false;
      }
      await cargarConfigVistas();
      const emailNuevo = (vals.email || "").trim();
      const passwordNueva = vals.password || "";
      if(passwordNueva && passwordNueva.length < 6){
        await mostrarAviso("La nueva contraseña debe tener al menos 6 caracteres.");
        return false;
      }
      const cambioEmail = emailNuevo && emailNuevo !== usuario.email;
      if(cambioEmail || passwordNueva){
        const { data: sesionActual } = await sb.auth.getSession();
        const token = sesionActual && sesionActual.session ? sesionActual.session.access_token : null;
        if(!token){ await mostrarAviso("Tu sesión expiró — volvé a iniciar sesión."); return false; }
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/editar-usuario`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({
            auth_user_id: usuario.auth_user_id,
            email: cambioEmail ? emailNuevo : undefined,
            password: passwordNueva || undefined,
          }),
        });
        const resultado = await resp.json().catch(() => ({}));
        if(!resp.ok){
          await mostrarAviso(resultado.error || "No se pudo cambiar el email/contraseña.");
          return false;
        }
      }
      const payload = {
        nombre: vals.nombre, apellido: vals.apellido,
        tipo_usuario: vals.tipo_usuario,
        sector_id: vals.tipo_usuario === "administrativo" ? (vals.sector_id || null) : null,
        clientes_lightdata_ids: esCliente ? clientesIds : null,
        es_admin: !!vals.es_admin, activo: !!vals.activo,
        vistas_permitidas: vistasValidasPara(vals.tipo_usuario, !!vals.es_admin, labelsAVistasClave(String(vals.vistas || "").split(",").map(s => s.trim()).filter(Boolean))),
      };
      const { error } = await sb.from("perfiles_usuario").update(payload).eq("id", usuario.id);
      if(error){ console.error(error); await mostrarAviso("No se pudo guardar — ¿tu usuario tiene permiso de administrador?"); return false; }
      await cargarAdminUsuarios();
      // Si el usuario editado es el que está logueado ahora mismo, el
      // sidebar tiene que reflejar el cambio sin esperar a recargar.
      if(stateSesion.perfil && stateSesion.perfil.id === usuario.id){
        stateSesion.perfil = { ...stateSesion.perfil, ...payload };
        aplicarPermisosVistas();
      }
    });
  });

  document.getElementById("btn-agregar-usuario").addEventListener("click", ()=>{
    abrirModalAbm("Agregar usuario", [
      { clave: "nombre", label: "Nombre", tipo: "texto" },
      { clave: "apellido", label: "Apellido", tipo: "texto" },
      { clave: "email", label: "Email", tipo: "texto" },
      { clave: "password", label: "Contraseña temporal (mínimo 6 caracteres)", tipo: "texto" },
      { clave: "tipo_usuario", label: "Tipo de usuario", tipo: "select", opciones: TIPOS_USUARIO_OPCIONES },
      {
        clave: "sector_id", label: "Sector", tipo: "select",
        opciones: sectoresDisponibles.map(s => ({ valor: s.id, texto: s.nombre })),
        mostrarSi: v => v.tipo_usuario === "administrativo",
      },
      {
        clave: "clientes", label: "Clientes asociados", tipo: "multiselect", span: true,
        opciones: catalogos.clientes.map(labelCliente),
        mostrarSi: v => v.tipo_usuario === "cliente",
      },
      { clave: "vistas", label: "Vistas permitidas", tipo: "multiselect", opciones: VISTAS_DISPONIBLES.map(v => v.label), opcionesSegun: opcionesVistasSegunTipo },
    ], { tipo_usuario: "administrativo" }, async (vals)=>{
      if(!vals.nombre || !vals.apellido || !vals.email || !vals.password){
        await mostrarAviso("Nombre, Apellido, Email y Contraseña son obligatorios.");
        return false;
      }
      const esCliente = vals.tipo_usuario === "cliente";
      const clientesIds = labelsClienteADid(String(vals.clientes || "").split(",").map(s => s.trim()).filter(Boolean));
      if(esCliente && !clientesIds.length){
        await mostrarAviso("Un usuario tipo Cliente necesita al menos un cliente asociado.");
        return false;
      }
      await cargarConfigVistas();
      const { data: sesionActual } = await sb.auth.getSession();
      const token = sesionActual && sesionActual.session ? sesionActual.session.access_token : null;
      if(!token){ await mostrarAviso("Tu sesión expiró — volvé a iniciar sesión."); return false; }

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/crear-usuario`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          nombre: vals.nombre, apellido: vals.apellido, email: vals.email, password: vals.password,
          tipo_usuario: vals.tipo_usuario,
          sector_id: vals.tipo_usuario === "administrativo" ? (vals.sector_id || null) : null,
          clientes_lightdata_ids: esCliente ? clientesIds : null,
          vistas_permitidas: vistasValidasPara(vals.tipo_usuario, false, labelsAVistasClave(String(vals.vistas || "").split(",").map(s => s.trim()).filter(Boolean))),
        }),
      });
      const resultado = await resp.json().catch(() => ({}));
      if(!resp.ok){
        await mostrarAviso(resultado.error || "No se pudo crear el usuario.");
        return false;
      }
      await cargarAdminUsuarios();
      await mostrarAviso("Usuario creado. Ya puede loguearse con el email y la contraseña que ingresaste.");
    });
  });
