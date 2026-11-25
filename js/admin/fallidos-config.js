// Configuración > Fallidos: mapeo Estado->Tipo/Destino (parametros_fallidos_mapeo)
// y umbrales de días (parametros_alertas_fallidos).
// Viene de index.html (Etapa 4a de migración a ES Modules, 2026-11-25).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";

  // ----- Administración: mapeo Estado->Tipo/Destino y umbrales de días -----
  let adminFallidosMapeoData = [];
  let adminFallidosMapeoSearch = "";
  const OPCIONES_TIPO_FALLIDO = ["Fallido", "Cambio"];
  const OPCIONES_DESTINO_FALLIDO = ["Vuelve a salir", "Devolver a tienda"];

  export async function cargarAdminFallidosMapeo(){
    const { data, error } = await sb.from("parametros_fallidos_mapeo").select("*").order("estado");
    if(error){ console.error("Error cargando parametros_fallidos_mapeo:", error); return; }
    adminFallidosMapeoData = data || [];
    renderAdminFallidosMapeo();
  }
  function renderAdminFallidosMapeo(){
    let filas = adminFallidosMapeoData;
    if(adminFallidosMapeoSearch) filas = filas.filter(f => f.estado.toLowerCase().includes(adminFallidosMapeoSearch));
    const tbody = document.getElementById("tabla-admin-fallidos-mapeo");
    if(!filas.length){ tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Sin estados mapeados.</td></tr>`; return; }
    tbody.innerHTML = filas.map(f => `
      <tr data-id="${f.id}">
        <td>${f.estado}</td>
        <td>${f.tipo}</td>
        <td>${f.destino}</td>
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
  function abrirFormularioMapeoFallido(titulo, valores, onGuardar){
    abrirModalAbm(titulo, [
      { clave: "estado", label: "Estado (tal cual lo trae Lightdata)", tipo: "texto" },
      { clave: "tipo", label: "Tipo", tipo: "select", opciones: OPCIONES_TIPO_FALLIDO },
      { clave: "destino", label: "Destino", tipo: "select", opciones: OPCIONES_DESTINO_FALLIDO },
    ], valores, onGuardar);
  }
  document.getElementById("buscar-admin-fallidos-mapeo").addEventListener("input", (e)=>{
    adminFallidosMapeoSearch = e.target.value.toLowerCase();
    renderAdminFallidosMapeo();
  });
  document.getElementById("btn-agregar-fallidos-mapeo").addEventListener("click", ()=>{
    abrirFormularioMapeoFallido("Agregar estado", { tipo: "Fallido", destino: "Vuelve a salir" }, async (vals)=>{
      if(!vals.estado || !vals.tipo || !vals.destino){ await mostrarAviso("Completá los 3 campos."); return false; }
      const { data, error } = await sb.from("parametros_fallidos_mapeo").insert(vals).select().single();
      if(error){ await mostrarAviso("No se pudo guardar (¿ese estado ya está mapeado?)."); return false; }
      adminFallidosMapeoData.push(data);
      renderAdminFallidosMapeo();
    });
  });
  document.getElementById("tabla-admin-fallidos-mapeo").addEventListener("click", async (e)=>{
    const btnEditar = e.target.closest(".btn-icono-chico.editar");
    const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
    if(btnEditar){
      const id = Number(btnEditar.dataset.id);
      const fila = adminFallidosMapeoData.find(f => f.id === id);
      abrirFormularioMapeoFallido("Editar estado", fila, async (vals)=>{
        const { error } = await sb.from("parametros_fallidos_mapeo").update(vals).eq("id", id);
        if(error){ await mostrarAviso("No se pudo guardar."); return false; }
        Object.assign(fila, vals);
        renderAdminFallidosMapeo();
      });
    }
    if(btnBorrar){
      const id = Number(btnBorrar.dataset.id);
      if(!(await mostrarConfirmacion("¿Borrar este mapeo? No se puede deshacer."))) return;
      const { error } = await sb.from("parametros_fallidos_mapeo").delete().eq("id", id);
      if(error){ await mostrarAviso("No se pudo borrar."); return; }
      adminFallidosMapeoData = adminFallidosMapeoData.filter(f => f.id !== id);
      renderAdminFallidosMapeo();
    }
  });

  let adminFallidosAlertasData = [];
  export async function cargarAdminFallidosAlertas(){
    const { data, error } = await sb.from("parametros_alertas_fallidos").select("*").order("valor_dias");
    if(error){ console.error("Error cargando parametros_alertas_fallidos:", error); return; }
    adminFallidosAlertasData = data || [];
    renderAdminFallidosAlertas();
  }
  function renderAdminFallidosAlertas(){
    const tbody = document.getElementById("tabla-admin-fallidos-alertas");
    tbody.innerHTML = adminFallidosAlertasData.map(a => `
      <tr data-clave="${a.clave}">
        <td>${a.clave}</td>
        <td>${a.valor_dias} días</td>
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
  document.getElementById("tabla-admin-fallidos-alertas").addEventListener("click", (e)=>{
    const btn = e.target.closest(".btn-icono-chico.editar");
    if(!btn) return;
    const clave = btn.dataset.clave;
    const fila = adminFallidosAlertasData.find(a => a.clave === clave);
    abrirModalAbm(`Editar umbral: ${clave}`, [
      { clave: "valor_dias", label: "Días", tipo: "number" },
    ], fila, async (vals)=>{
      const valor = Number(vals.valor_dias);
      if(!valor || valor < 1){ await mostrarAviso("Tiene que ser un número mayor a 0."); return false; }
      const { error } = await sb.from("parametros_alertas_fallidos").update({ valor_dias: valor }).eq("clave", clave);
      if(error){ await mostrarAviso("No se pudo guardar."); return false; }
      fila.valor_dias = valor;
      renderAdminFallidosAlertas();
    });
  });
