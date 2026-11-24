// ABM de Turnos (usa "hora" en vez de "nombre" como valor principal).
// Viene de index.html (Etapa 2 de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";

  // Turnos usa "hora" en vez de "nombre" como valor principal — formulario propio, mismo patrón de modal.
  let adminTurnosData = [];
  async function cargarAdminTurnosReal(){
    const { data, error } = await sb.from("parametros_turnos").select("*").order("hora");
    if(error){ console.error("Error cargando parametros_turnos:", error); return; }
    adminTurnosData = data || [];
    renderAdminTurnosReal();
  }
  function renderAdminTurnosReal(){
    const tbody = document.getElementById("tabla-admin-turnos");
    if(!adminTurnosData.length){ tbody.innerHTML = `<tr><td colspan="3" class="sin-datos">Sin turnos cargados.</td></tr>`; return; }
    tbody.innerHTML = adminTurnosData.map(t => `
      <tr class="${t.activo ? "" : "fila-inactiva"}" data-id="${t.id}">
        <td>${t.hora ? t.hora.slice(0,5) : "—"}${t.activo ? "" : '<span class="badge-inactivo">Inactivo</span>'}</td>
        <td>${t.activo ? "Sí" : "No"}</td>
        <td class="col-opciones">
          <span class="opciones-fila">
            <button type="button" class="btn-icono-chico editar" data-id="${t.id}" title="Editar"><i data-lucide="pencil"></i></button>
            <button type="button" class="btn-icono-chico borrar" data-id="${t.id}" title="Borrar"><i data-lucide="trash-2"></i></button>
          </span>
        </td>
      </tr>
    `).join("");
    lucide.createIcons();
  }
  document.getElementById("buscar-admin-turnos").addEventListener("input", renderAdminTurnosReal); // los turnos no se filtran por texto, campo queda para consistencia visual
  document.getElementById("btn-agregar-turno").addEventListener("click", ()=>{
    abrirModalAbm("Agregar turno", [
      { clave: "hora", label: "Hora", tipo: "time" },
      { clave: "activo", label: "Activo", tipo: "checkbox" },
    ], { activo: true }, async (vals)=>{
      if(!vals.hora){ await mostrarAviso("La hora es obligatoria."); return false; }
      const { data, error } = await sb.from("parametros_turnos").insert({ hora: vals.hora, activo: !!vals.activo }).select().single();
      if(error){ await mostrarAviso("No se pudo guardar (¿ya existe ese horario?)."); return false; }
      adminTurnosData.push(data);
      renderAdminTurnosReal();
    });
  });
  document.getElementById("tabla-admin-turnos").addEventListener("click", async (e)=>{
    const btnEditar = e.target.closest(".btn-icono-chico.editar");
    const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
    if(btnEditar){
      const id = Number(btnEditar.dataset.id);
      const fila = adminTurnosData.find(f => f.id === id);
      abrirModalAbm("Editar turno", [
        { clave: "hora", label: "Hora", tipo: "time" },
        { clave: "activo", label: "Activo", tipo: "checkbox" },
      ], { hora: fila.hora ? fila.hora.slice(0,5) : "", activo: fila.activo }, async (vals)=>{
        const { error } = await sb.from("parametros_turnos").update({ hora: vals.hora, activo: !!vals.activo }).eq("id", id);
        if(error){ await mostrarAviso("No se pudo guardar."); return false; }
        fila.hora = vals.hora; fila.activo = !!vals.activo;
        renderAdminTurnosReal();
      });
    }
    if(btnBorrar){
      const id = Number(btnBorrar.dataset.id);
      if(!(await mostrarConfirmacion("¿Borrar este turno? No se puede deshacer."))) return;
      const { error } = await sb.from("parametros_turnos").delete().eq("id", id);
      if(error){ await mostrarAviso("No se pudo borrar."); return; }
      adminTurnosData = adminTurnosData.filter(f => f.id !== id);
      renderAdminTurnosReal();
    }
  });
  export const abmTurnos = {
    cargar: cargarAdminTurnosReal,
    obtenerActivos: () => adminTurnosData.filter(t => t.activo).map(t => t.hora.slice(0, 5)),
  };
