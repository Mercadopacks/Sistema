// Configuración > Umbrales de alerta (parametros_alertas): filas fijas, solo edición.
// Viene de index.html (Etapa 4a de migración a ES Modules, 2026-11-25).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { mostrarAviso } from "../ui/dialogos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";

  // ----- Umbrales de alerta: 4 filas fijas, solo se editan (no alta/baja) -----
  let adminAlertasData = [];
  export async function cargarAdminAlertas(){
    const { data, error } = await sb.from("parametros_alertas").select("*").order("clave");
    if(error){ console.error("Error cargando parametros_alertas:", error); return; }
    adminAlertasData = data || [];
    renderAdminAlertas();
  }
  function renderAdminAlertas(){
    const tbody = document.getElementById("tabla-admin-alertas");
    tbody.innerHTML = adminAlertasData.map(a => `
      <tr data-clave="${a.clave}">
        <td>${a.clave}</td>
        <td>${a.valor_minutos} min</td>
        <td class="texto-muted">${a.descripcion || ""}</td>
        <td class="col-opciones">
          <span class="opciones-fila">
            <button type="button" class="btn-icono-chico editar" data-clave="${a.clave}" title="Editar"><i data-lucide="pencil"></i></button>
          </span>
        </td>
      </tr>
    `).join("");
    lucide.createIcons();
  }
  document.getElementById("tabla-admin-alertas").addEventListener("click", (e)=>{
    const btn = e.target.closest(".btn-icono-chico.editar");
    if(!btn) return;
    const clave = btn.dataset.clave;
    const fila = adminAlertasData.find(a => a.clave === clave);
    abrirModalAbm(`Editar umbral: ${clave}`, [
      { clave: "valor_minutos", label: "Minutos", tipo: "number" },
    ], fila, async (vals)=>{
      const valor = Number(vals.valor_minutos);
      if(!valor || valor < 1){ await mostrarAviso("Tiene que ser un número mayor a 0."); return false; }
      const { error } = await sb.from("parametros_alertas").update({ valor_minutos: valor }).eq("clave", clave);
      if(error){ await mostrarAviso("No se pudo guardar."); return false; }
      fila.valor_minutos = valor;
      renderAdminAlertas();
    });
  });
