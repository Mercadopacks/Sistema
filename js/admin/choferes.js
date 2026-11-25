// Configuración > Repartidores (roster choferes_roster): grilla con filtros,
// detalle, alta/edición/borrado y aviso de pendientes de completar.
// Viene de index.html (Etapa 4a de migración a ES Modules, 2026-11-25).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { tituloNombre } from "../core/formato.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { crearComboGenerico, crearPopoverGenerico } from "../ui/combos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";
import { abmVehiculos, abmZonas } from "./abm-simple.js";
import { abmTurnos } from "./abm-turnos.js";
import { abmLocalidades } from "./abm-localidades.js";
import { pendientesConfigState, actualizarIconoPendientesConfig } from "./pendientes-config.js";

  // ----- Choferes (roster): más campos, con combos de Vehículo/Zona referenciando sus propios ABM -----
  let adminChoferesData = [];
  let adminChoferesLightdataUsuarios = {}; // id -> usuario (de lightdata_usuarios), para la columna "Usuario"
  let adminChoferesSearch = "";
  let adminChoferesSoloPendientes = false;
  let adminChoferesFiltros = { vehiculo: "", turno: "", zona: "", activo: "", sabado: "" };
  // 858 filas (toda la plantilla histórica, no solo los activos) — se
  // piden UNA vez por sesión, no cada vez que se entra a la pantalla
  // (ver Regla de consultas, reglas_de_negocio.md sección 1, 2026-11-21).
  // Alta/edición/borrado actualizan `adminChoferesData` a mano, así que
  // no hace falta volver a pedir nada después de esas acciones.
  let adminChoferesCargado = false;

  export async function cargarAdminChoferes(){
    if(adminChoferesCargado){
      await Promise.all([abmVehiculos.cargar(), abmLocalidades.cargar()]);
      return;
    }
    const [{ data, error }] = await Promise.all([
      sb.from("choferes_roster").select("*").order("nombre"),
      abmVehiculos.cargar(), abmLocalidades.cargar(),
    ]);
    if(error){ console.error("Error cargando choferes_roster:", error); return; }
    adminChoferesData = data || [];
    adminChoferesCargado = true;

    const idsLightdata = adminChoferesData.map(f => f.lightdata_id).filter(id => id != null);
    adminChoferesLightdataUsuarios = {};
    if(idsLightdata.length){
      const { data: usuariosLd, error: errorLd } = await sb.from("lightdata_usuarios").select("lightdata_id,usuario").in("lightdata_id", idsLightdata);
      if(errorLd){ console.error("Error cargando lightdata_usuarios:", errorLd); }
      else for(const u of usuariosLd) adminChoferesLightdataUsuarios[u.lightdata_id] = u.usuario;
    }

    llenarFiltrosAdminChoferes();
    renderAdminChoferes();
    actualizarAvisoChoferesPendientes();
  }

  // Las opciones de los combos-filtro de Vehículo/Turno/Zona salen de los
  // valores que realmente tienen los repartidores cargados (si no habría
  // opciones sin ningún resultado). Los <li> se arman solo la primera vez
  // (crearComboGenerico engancha los listeners sobre esos <li> puntuales —
  // regla 7 del dashboard: lo que el <script> engancha tiene que existir
  // antes, y acá además no hay que re-enganchar en cada recarga).
  let adminChoferesFiltrosInicializados = false;

  function llenarFiltrosAdminChoferes(){
    const opciones = (campo, formatear) => [...new Set(adminChoferesData.map(f => f[campo]).filter(v => v != null && v !== ""))]
      .sort()
      .map(v => `<li data-valor="${v}">${formatear ? formatear(v) : v}</li>`)
      .join("");

    document.querySelector("#combo-vehiculo-choferes .combo-filtro-lista").innerHTML = `<li data-valor="" aria-selected="true">Todos</li>` + opciones("tipo_vehiculo");
    document.querySelector("#combo-turno-choferes .combo-filtro-lista").innerHTML = `<li data-valor="" aria-selected="true">Todos</li>` + opciones("turno", v => v.slice(0,5));
    document.querySelector("#combo-zona-choferes .combo-filtro-lista").innerHTML = `<li data-valor="" aria-selected="true">Todas</li>` + opciones("zona");

    if(!adminChoferesFiltrosInicializados){
      crearPopoverGenerico("popover-filtros-choferes");
      crearComboGenerico("combo-vehiculo-choferes", (valor)=>{ adminChoferesFiltros.vehiculo = valor; renderAdminChoferes(); });
      crearComboGenerico("combo-turno-choferes", (valor)=>{ adminChoferesFiltros.turno = valor; renderAdminChoferes(); });
      crearComboGenerico("combo-zona-choferes", (valor)=>{ adminChoferesFiltros.zona = valor; renderAdminChoferes(); });
      crearComboGenerico("combo-activo-choferes", (valor)=>{ adminChoferesFiltros.activo = valor; renderAdminChoferes(); });
      crearComboGenerico("combo-sabado-choferes", (valor)=>{ adminChoferesFiltros.sabado = valor; renderAdminChoferes(); });
      adminChoferesFiltrosInicializados = true;
    }
  }

  // Choferes que se dieron de alta automáticamente desde Lightdata
  // (sincronizar_lightdata.py, ver integracion_usuarios_lightdata.md) y
  // todavía no tienen vehículo/zona/turno/localidad propios.
  function actualizarAvisoChoferesPendientes(){
    const pendientes = adminChoferesData.filter(f => f.pendiente_completar).length;
    const aviso = document.getElementById("aviso-choferes-pendientes");
    aviso.hidden = pendientes === 0;
    document.getElementById("aviso-choferes-pendientes-texto").textContent =
      `${pendientes} repartidor${pendientes === 1 ? "" : "es"} pendiente${pendientes === 1 ? "" : "s"} de completar`;
    const elSubmenu = document.getElementById("contador-choferes-pendientes-submenu");
    elSubmenu.hidden = pendientes === 0;
    elSubmenu.textContent = pendientes;
    pendientesConfigState.choferes = pendientes;
    actualizarIconoPendientesConfig();
  }

  function renderAdminChoferes(){
    let filas = adminChoferesData;
    if(adminChoferesSearch) filas = filas.filter(f =>
      (f.nombre || "").toLowerCase().includes(adminChoferesSearch) ||
      (adminChoferesLightdataUsuarios[f.lightdata_id] || "").toLowerCase().includes(adminChoferesSearch)
    );
    if(adminChoferesSoloPendientes) filas = filas.filter(f => f.pendiente_completar);
    if(adminChoferesFiltros.vehiculo) filas = filas.filter(f => f.tipo_vehiculo === adminChoferesFiltros.vehiculo);
    if(adminChoferesFiltros.turno) filas = filas.filter(f => f.turno === adminChoferesFiltros.turno);
    if(adminChoferesFiltros.zona) filas = filas.filter(f => f.zona === adminChoferesFiltros.zona);
    if(adminChoferesFiltros.activo) filas = filas.filter(f => !!f.activo === (adminChoferesFiltros.activo === "si"));
    if(adminChoferesFiltros.sabado) filas = filas.filter(f => !!f.asiste_sabado === (adminChoferesFiltros.sabado === "si"));

    const tbody = document.getElementById("tabla-admin-choferes");
    if(!filas.length){
      tbody.innerHTML = `<tr><td colspan="8" class="sin-datos">Sin repartidores. Usá "Agregar repartidor" para empezar.</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(f => `
      <tr class="${f.activo ? "" : "fila-inactiva"} ${f.pendiente_completar ? "fila-pendiente-completar" : ""}" data-id="${f.id}">
        <td>${f.pendiente_completar ? `<span class="punto-pendiente" tabindex="0" role="img" data-tip="Pendiente de completar: se dio de alta automáticamente desde Lightdata, todavía le falta vehículo/zona/turno/localidad."></span>` : ""}${tituloNombre(f.nombre)}${f.es_backup ? ' <span class="texto-muted">(backup)</span>' : ""}</td>
        <td>${adminChoferesLightdataUsuarios[f.lightdata_id] || "—"}</td>
        <td>${f.tipo_vehiculo || "—"}</td>
        <td>${f.turno ? f.turno.slice(0,5) : "—"}</td>
        <td>${f.zona || "—"}</td>
        <td>${f.activo ? "Sí" : "No"}</td>
        <td>${f.asiste_sabado ? "Sí" : "No"}</td>
        <td class="col-opciones">
          <span class="opciones-fila">
            <button type="button" class="btn-icono-chico ver" data-id="${f.id}" title="Ver detalle"><i data-lucide="eye"></i></button>
            <button type="button" class="btn-icono-chico editar" data-id="${f.id}" title="Editar"><i data-lucide="pencil"></i></button>
            <button type="button" class="btn-icono-chico borrar" data-id="${f.id}" title="Borrar"><i data-lucide="trash-2"></i></button>
          </span>
        </td>
      </tr>
    `).join("");
    lucide.createIcons();
  }

  function abrirDetalleChofer(id){
    const f = adminChoferesData.find(x => x.id === id);
    if(!f) return;
    document.getElementById("modal-detalle-repartidor-titulo").textContent = `Detalle — ${tituloNombre(f.nombre)}`;
    // { icono, label, valor, span } — span para los campos de texto largo
    // (Localidades/Observaciones), que no entran bien en una columna de 3.
    const campos = [
      { icono: "hash", label: "ID Lightdata", valor: f.lightdata_id ?? "—" },
      { icono: "at-sign", label: "Usuario (Lightdata)", valor: adminChoferesLightdataUsuarios[f.lightdata_id] || "—" },
      { icono: "car", label: "Vehículo", valor: f.tipo_vehiculo || "—" },
      { icono: "clock", label: "Turno", valor: f.turno ? f.turno.slice(0,5) : "—" },
      { icono: "map", label: "Zona", valor: f.zona || "—" },
      { icono: "repeat", label: "Es backup", valor: f.es_backup ? "Sí" : "No" },
      { icono: "check-circle-2", label: "Activo", valor: f.activo ? "Sí" : "No" },
      { icono: "calendar", label: "Asiste sábado", valor: f.asiste_sabado ? "Sí" : "No" },
      { icono: "alert-triangle", label: "Pendiente de completar", valor: f.pendiente_completar ? "Sí" : "No" },
      { icono: "map-pinned", label: "Localidades", valor: f.localidades || "—", span: true },
      { icono: "sticky-note", label: "Observaciones", valor: f.observaciones || "—", span: true },
    ];
    document.getElementById("modal-detalle-repartidor-cuerpo").innerHTML = `
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
    document.getElementById("modal-detalle-repartidor").hidden = false;
  }
  document.getElementById("modal-detalle-repartidor-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-detalle-repartidor").hidden = true;
  });
  document.getElementById("modal-detalle-repartidor").addEventListener("click", (e)=>{
    if(e.target.id === "modal-detalle-repartidor") document.getElementById("modal-detalle-repartidor").hidden = true;
  });

  document.getElementById("btn-ver-solo-pendientes").addEventListener("click", (e)=>{
    adminChoferesSoloPendientes = !adminChoferesSoloPendientes;
    e.currentTarget.setAttribute("aria-expanded", String(adminChoferesSoloPendientes));
    e.currentTarget.innerHTML = adminChoferesSoloPendientes
      ? '<i data-lucide="x"></i>Ver todos'
      : '<i data-lucide="filter"></i>Ver solo pendientes';
    lucide.createIcons();
    renderAdminChoferes();
  });

  document.getElementById("buscar-admin-choferes").addEventListener("input", (e)=>{
    adminChoferesSearch = e.target.value.toLowerCase();
    renderAdminChoferes();
  });


  function abrirFormularioChofer(titulo, valores, onGuardar){
    abrirModalAbm(titulo, [
      { clave: "nombre", label: "Nombre", tipo: "texto", icono: "user", span: true },
      { clave: "tipo_vehiculo", label: "Vehículo", tipo: "select", opciones: abmVehiculos.obtenerActivos(), icono: "car" },
      { clave: "turno", label: "Turno", tipo: "select", opciones: [{ valor: "", texto: "— Sin turno —" }, ...abmTurnos.obtenerActivos()], icono: "clock" },
      { clave: "zona", label: "Zona", tipo: "select", opciones: abmZonas.obtenerActivos(), icono: "map" },
      { clave: "localidades", label: "Localidades", tipo: "multiselect", opciones: abmLocalidades.obtenerActivos(), icono: "map-pinned", span: true },
      { clave: "observaciones", label: "Observaciones", tipo: "texto", icono: "sticky-note", span: true },
      { clave: "activo", label: "Activo", tipo: "checkbox", icono: "check-circle-2" },
      { clave: "es_backup", label: "Es backup (sin turno fijo)", tipo: "checkbox", icono: "repeat" },
      { clave: "asiste_sabado", label: "Asiste sábado", tipo: "checkbox", icono: "calendar" },
    ], valores, onGuardar, { grid: true });
  }

  document.getElementById("btn-agregar-chofer-roster").addEventListener("click", ()=>{
    abrirFormularioChofer("Agregar repartidor", { activo: true }, async (vals)=>{
      if(!vals.nombre){ await mostrarAviso("El nombre es obligatorio."); return false; }
      if(vals.turno === "") vals.turno = null;
      const { data, error } = await sb.from("choferes_roster").insert(vals).select().single();
      if(error){ console.error(error); await mostrarAviso("No se pudo agregar (¿ya existe ese nombre?)."); return false; }
      adminChoferesData.push(data);
      renderAdminChoferes();
    });
  });

  document.getElementById("tabla-admin-choferes").addEventListener("click", async (e)=>{
    const btnVer = e.target.closest(".btn-icono-chico.ver");
    const btnEditar = e.target.closest(".btn-icono-chico.editar");
    const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
    if(btnVer){
      abrirDetalleChofer(Number(btnVer.dataset.id));
    }
    if(btnEditar){
      const id = Number(btnEditar.dataset.id);
      const fila = adminChoferesData.find(f => f.id === id);
      abrirFormularioChofer("Editar repartidor", { ...fila, turno: fila.turno ? fila.turno.slice(0,5) : "" }, async (vals)=>{
        if(!vals.nombre){ await mostrarAviso("El nombre es obligatorio."); return false; }
        if(vals.turno === "") vals.turno = null;
        // Si vino pendiente de completar (alta automática desde Lightdata,
        // ver integracion_usuarios_lightdata.md) y ya se cargaron los datos
        // que faltaban, se destraba sola — no hace falta un botón aparte.
        if(fila.pendiente_completar && vals.tipo_vehiculo && vals.zona && vals.localidades && vals.localidades.length){
          vals.pendiente_completar = false;
        }
        const { error } = await sb.from("choferes_roster").update(vals).eq("id", id);
        if(error){ await mostrarAviso("No se pudo guardar."); return false; }
        Object.assign(fila, vals);
        renderAdminChoferes();
        actualizarAvisoChoferesPendientes();
      });
    }
    if(btnBorrar){
      const id = Number(btnBorrar.dataset.id);
      if(!(await mostrarConfirmacion("¿Borrar este repartidor del roster? No se puede deshacer."))) return;
      const { error } = await sb.from("choferes_roster").delete().eq("id", id);
      if(error){ await mostrarAviso("No se pudo borrar."); return; }
      adminChoferesData = adminChoferesData.filter(f => f.id !== id);
      renderAdminChoferes();
      actualizarAvisoChoferesPendientes();
    }
  });
