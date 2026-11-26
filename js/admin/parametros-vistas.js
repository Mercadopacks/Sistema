// Configuración > Vistas (pedido 2026-11-26): qué vistas puede ver un
// usuario tipo_usuario="cliente" dejó de ser un flag hardcodeado en
// js/core/sesion.js (soloAdmin/paraCliente) — se equivocó 2 veces
// (Liquidación Consolidada quedó marcada soloAdmin, pisando el acceso
// que el propio módulo necesita). Ahora es un toggle acá, por vista,
// editable sin tocar código — ver parametros_vistas (tabla) y
// js/admin/usuarios.js (vistasValidasPara(), que lee esta misma tabla
// al guardar "Vistas permitidas" de un usuario).
import { sb } from "../core/supabase.js";
import { mostrarAviso } from "../ui/dialogos.js";
import { VISTAS_DISPONIBLES } from "../core/sesion.js";

let filasVistas = [];

// Pedido 2026-11-26 (2da vuelta): 3 columnas configurables — Administrador
// nunca se filtra (es_admin bypasea todo, no tiene sentido un toggle
// acá) — Administrativo/Cliente/Repartidor sí.
const COLUMNAS = [
  { campo: "visible_para_administrativos", label: "Administrativo" },
  { campo: "visible_para_clientes", label: "Cliente" },
  { campo: "visible_para_repartidores", label: "Repartidor" },
];

export async function cargarAdminParametrosVistas(){
  const tbody = document.getElementById("tabla-admin-vistas");
  tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Cargando…</td></tr>`;
  const { data, error } = await sb.from("parametros_vistas").select("clave,visible_para_clientes,visible_para_administrativos,visible_para_repartidores");
  if(error){ console.error("Error cargando parametros_vistas:", error); tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Error cargando: ${error.message || "revisá la consola"}.</td></tr>`; return; }
  const porClave = new Map((data || []).map(v => [v.clave, v]));
  // Toda vista declarada en VISTAS_DISPONIBLES aparece acá, aunque
  // todavía no tenga fila sembrada en parametros_vistas (vista nueva) —
  // se muestra destildada por default hasta que un admin la habilite.
  filasVistas = VISTAS_DISPONIBLES.map(v => {
    const fila = porClave.get(v.clave) || {};
    return {
      clave: v.clave, label: v.label,
      visible_para_administrativos: fila.visible_para_administrativos ?? true,
      visible_para_clientes: fila.visible_para_clientes ?? false,
      visible_para_repartidores: fila.visible_para_repartidores ?? false,
    };
  });
  render();
}

function render(){
  const tbody = document.getElementById("tabla-admin-vistas");
  tbody.innerHTML = filasVistas.map(v => `
    <tr>
      <td>${v.label}</td>
      ${COLUMNAS.map(c => `
        <td class="col-num">
          <input type="checkbox" class="check-visible-rol" data-clave="${v.clave}" data-campo="${c.campo}" ${v[c.campo] ? "checked" : ""} />
        </td>
      `).join("")}
    </tr>
  `).join("");
}

document.getElementById("tabla-admin-vistas").addEventListener("change", async (e)=>{
  const chk = e.target.closest(".check-visible-rol");
  if(!chk) return;
  const clave = chk.dataset.clave;
  const campo = chk.dataset.campo;
  const fila = filasVistas.find(v => v.clave === clave);
  const valorAnterior = fila ? fila[campo] : false;
  chk.disabled = true;
  const { error } = await sb.from("parametros_vistas")
    .upsert({ clave, label: fila.label, [campo]: chk.checked }, { onConflict: "clave" });
  chk.disabled = false;
  if(error){
    console.error("Error guardando parametros_vistas:", error);
    await mostrarAviso("No se pudo guardar.");
    chk.checked = valorAnterior;
    return;
  }
  if(fila) fila[campo] = chk.checked;
});
