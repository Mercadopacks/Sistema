// ABM simple (id + nombre + activo): Vehículos, Zonas, Sectores, Cordones,
// Tamaños de paquete.
// Viene de index.html (Etapa 2 de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";
import { crearComboGenerico, crearPopoverGenerico } from "../ui/combos.js";

  // ----- Fábrica de ABM simple (id + nombre + activo): Vehículos, Zonas, Localidades -----
  function crearAbmSimple({ tabla, tbodyId, buscarId, btnAgregarId, titulo, orden }){
    let datos = [];
    let busqueda = "";
    // Pedido 2026-11-27: botón "Filtrar" (mismo estilo/funcionalidad que
    // Repartidores, ver choferes.js) en todos los módulos de Configuración.
    // Los 5 ABMs que usan esta factory comparten la misma forma (nombre +
    // activo), así que un solo filtro "Activo" acá cubre los 5 de una —
    // los ids del popover/combo se derivan de buscarId ("buscar-admin-X"
    // -> "popover-filtros-admin-X" / "combo-activo-admin-X") para no tener
    // que agregar un parámetro nuevo a cada instanciación.
    let filtroActivo = "";
    const slug = buscarId.replace(/^buscar-/, "");
    const popoverId = `popover-filtros-${slug}`;
    const comboActivoId = `combo-activo-${slug}`;
    // Regla de consultas (2026-11-21, ver reglas_de_negocio.md sección 1):
    // estas tablas de parámetros son chicas y cambian poco — se piden UNA
    // vez por sesión, no cada vez que se entra a la pantalla. Antes,
    // navegar a Choferes/Localidades/etc. volvía a pedir Vehículos,
    // Cordones, Zonas... de cero cada vez, aunque ya estuvieran en
    // memoria sin cambios. `forzar=true` lo saltea (lo usan alta/edición/
    // borrado locales, que ya actualizan `datos` a mano sin volver a
    // pedir nada — no hace falta en este ABM, queda disponible por si
    // algún consumidor externo necesita refrescar).
    let cargado = false;

    async function cargar(forzar){
      if(cargado && !forzar) return;
      const { data, error } = await sb.from(tabla).select("*").order(orden || "nombre");
      if(error){ console.error(`Error cargando ${tabla}:`, error); return; }
      datos = data || [];
      cargado = true;
      render();
    }

    function render(){
      let filas = datos;
      if(busqueda) filas = filas.filter(f => (f.nombre || "").toLowerCase().includes(busqueda));
      if(filtroActivo) filas = filas.filter(f => (filtroActivo === "si") === !!f.activo);
      const tbody = document.getElementById(tbodyId);
      if(!filas.length){
        tbody.innerHTML = `<tr><td colspan="3" class="sin-datos">Sin ${titulo.toLowerCase()} cargados.</td></tr>`;
        return;
      }
      tbody.innerHTML = filas.map(f => `
        <tr class="${f.activo ? "" : "fila-inactiva"}" data-id="${f.id}">
          <td>${f.nombre}${f.activo ? "" : '<span class="badge-inactivo">Inactivo</span>'}</td>
          <td>${f.activo ? "Sí" : "No"}</td>
          <td class="col-opciones">
            <span class="opciones-fila">
              <button type="button" class="btn-icono-chico editar" data-id="${f.id}" title="Editar"><i data-lucide="pencil"></i></button>
              <button type="button" class="btn-icono-chico borrar" data-id="${f.id}" title="Borrar"><i data-lucide="trash-2"></i></button>
            </span>
          </td>
        </tr>
      `).join("");
      lucide.createIcons();
    }

    function abrirAlta(){
      abrirModalAbm(`Agregar ${titulo.toLowerCase()}`, [
        { clave: "nombre", label: "Nombre", tipo: "texto" },
        { clave: "activo", label: "Activo", tipo: "checkbox" },
      ], { activo: true }, async (vals)=>{
        if(!vals.nombre){ await mostrarAviso("El nombre es obligatorio."); return false; }
        const { data, error } = await sb.from(tabla).insert({ nombre: vals.nombre, activo: !!vals.activo }).select().single();
        if(error){ await mostrarAviso("No se pudo guardar (¿ya existe ese nombre?)."); return false; }
        datos.push(data);
        render();
      });
    }

    function abrirEdicion(id){
      const fila = datos.find(f => f.id === id);
      if(!fila) return;
      abrirModalAbm(`Editar ${titulo.toLowerCase()}`, [
        { clave: "nombre", label: "Nombre", tipo: "texto" },
        { clave: "activo", label: "Activo", tipo: "checkbox" },
      ], fila, async (vals)=>{
        if(!vals.nombre){ await mostrarAviso("El nombre es obligatorio."); return false; }
        const { error } = await sb.from(tabla).update({ nombre: vals.nombre, activo: !!vals.activo }).eq("id", id);
        if(error){ await mostrarAviso("No se pudo guardar."); return false; }
        fila.nombre = vals.nombre; fila.activo = !!vals.activo;
        render();
      });
    }

    async function borrar(id){
      if(!(await mostrarConfirmacion("¿Borrar este registro? No se puede deshacer."))) return;
      const { error } = await sb.from(tabla).delete().eq("id", id);
      if(error){ console.error(error); await mostrarAviso("No se pudo borrar."); return; }
      datos = datos.filter(f => f.id !== id);
      render();
    }

    document.getElementById(buscarId).addEventListener("input", (e)=>{
      busqueda = e.target.value.toLowerCase();
      render();
    });
    crearPopoverGenerico(popoverId);
    crearComboGenerico(comboActivoId, (valor)=>{ filtroActivo = valor; render(); });
    document.getElementById(btnAgregarId).addEventListener("click", abrirAlta);
    document.getElementById(tbodyId).addEventListener("click", (e)=>{
      const btnEditar = e.target.closest(".btn-icono-chico.editar");
      const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
      if(btnEditar) abrirEdicion(Number(btnEditar.dataset.id));
      if(btnBorrar) borrar(Number(btnBorrar.dataset.id));
    });

    return {
      cargar,
      obtenerActivos: () => datos.filter(f => f.activo).map(f => f.nombre),
      obtenerActivosConId: () => datos.filter(f => f.activo).map(f => ({ valor: f.id, texto: f.nombre })),
    };
  }

  export const abmVehiculos = crearAbmSimple({ tabla: "parametros_vehiculos", tbodyId: "tabla-admin-vehiculos", buscarId: "buscar-admin-vehiculos", btnAgregarId: "btn-agregar-vehiculo", titulo: "Vehículo" });
  export const abmZonas = crearAbmSimple({ tabla: "parametros_zonas", tbodyId: "tabla-admin-zonas", buscarId: "buscar-admin-zonas", btnAgregarId: "btn-agregar-zona", titulo: "Zona" });
  export const abmSectores = crearAbmSimple({ tabla: "parametros_sectores", tbodyId: "tabla-admin-sectores", buscarId: "buscar-admin-sectores", btnAgregarId: "btn-agregar-sector", titulo: "Sector" });
  export const abmCordones = crearAbmSimple({ tabla: "parametros_cordones", tbodyId: "tabla-admin-cordones", buscarId: "buscar-admin-cordones", btnAgregarId: "btn-agregar-cordon", titulo: "Cordón", orden: "orden" });
  export const abmTamanosPaquete = crearAbmSimple({ tabla: "parametros_tamanos_paquete", tbodyId: "tabla-admin-tamanos-paquete", buscarId: "buscar-admin-tamanos-paquete", btnAgregarId: "btn-agregar-tamano-paquete", titulo: "Tamaño de paquete", orden: "orden" });
