// Liquidación Consolidada (pedido 2026-11-26, ver docs/liquidacion_
// consolidada.md) — 2da vuelta. Una cuenta principal puede tener
// subcuentas vinculadas (clientes_relaciones); la consolidada se arma
// SOBRE las liquidaciones individuales YA generadas de cada una (nunca
// las recalcula ni las modifica — regla de negocio 7 del documento) y
// calcula la diferencia entre la tarifa propia "efectiva" de cada
// subcuenta y la tarifa propia "efectiva" de la cuenta PRINCIPAL (la
// referencia SIEMPRE es la tarifa de la principal, pedido 2026-11-26 —
// ya no se pacta un valor aparte por subcuenta). Esa diferencia SIEMPRE
// se resta del saldo de la principal, sin condición de signo: el
// resultado sale solo a favor o en contra según el signo de la propia
// diferencia.
//
// La vinculación cuenta principal <-> subcuenta (ABM de
// clientes_relaciones) vive en Configuración (cargarAdminRelacionesClientes,
// exportada acá pero montada desde el sidebar de Configuración en
// index.html) — esta pantalla (cargarLiquidacionConsolidada) es la que en
// el futuro también va a poder ver la propia cuenta principal, así que no
// puede traer acciones de administración de vínculos.
//
// Simplificación documentada (a validar con el usuario, no asumir que es
// definitiva): la "tarifa propia efectiva" de una cuenta sale de dividir
// monto_a_pagar de su liquidación individual por sus paquetes liquidados
// (envíos + turbo) — un promedio implícito, no el precio real por
// tamaño/cordón (que puede variar envío a envío). Para el caso de uso
// descripto en el documento (tarifa única por paquete) es exacto; si en
// la práctica hay mezcla de tamaños con precios distintos, esto da un
// promedio ponderado, no una comparación por tamaño.
import { sb } from "../core/supabase.js";
import { tituloTexto, formatearMoneda, formatearFecha } from "../core/formato.js";
import { crearComboGenerico } from "../ui/combos.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { catalogos, nombreCliente } from "../core/catalogos.js";
import { fechaART } from "../core/fechas.js";

function labelEstadoConsolidada(estado){
  if(estado === "generada") return { texto: "Generada", clase: "verde" };
  if(estado === "pagada") return { texto: "Pagada", clase: "dorado" };
  if(estado === "anulada") return { texto: "Anulada", clase: "gris" };
  return { texto: estado, clase: "gris" };
}

async function asegurarCatalogoClientes(){
  if(catalogos.clientes.length) return;
  const { data, error } = await sb.from("lightdata_clientes").select("did,codigo,nombre_fantasia").eq("habilitado", true).order("nombre_fantasia");
  if(error){ console.error("Error cargando clientes:", error); return; }
  catalogos.clientes = data || [];
}

// ===================== Configuración → "Cuentas Vinculadas" (ABM de relaciones) =====================
// Admin-only: acá se vincula/desvincula una subcuenta y se la da de baja.
// Sin tarifa de referencia ni signo de ajuste (pedido 2026-11-26): la
// referencia siempre es la tarifa propia de la principal, y la
// diferencia siempre resta — nada de eso se configura por relación.

const stateRelaciones = { didPrincipal: null, relaciones: [] };

async function repoblarComboPrincipalRelaciones(){
  await asegurarCatalogoClientes();
  const wrap = document.getElementById("combo-relaciones-principal-wrap");
  if(!wrap) return;
  const actual = stateRelaciones.didPrincipal;
  const actualTexto = actual ? tituloTexto(nombreCliente(catalogos.clientes.find(c => c.did === actual) || {})) : "Elegir cuenta principal…";
  wrap.innerHTML = `
    <div class="combo-filtro" id="combo-relaciones-principal">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${actualTexto}</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${catalogos.clientes.map(c => `<li data-valor="${c.did}" ${c.did === actual ? 'aria-selected="true"' : ""}>${tituloTexto(nombreCliente(c))}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-relaciones-principal", async (valor)=>{
    stateRelaciones.didPrincipal = Number(valor);
    await cargarRelaciones();
  });
}

async function cargarRelaciones(){
  const tbody = document.getElementById("tabla-consolidada-relaciones");
  if(!tbody) return;
  if(!stateRelaciones.didPrincipal){ tbody.innerHTML = ""; return; }
  tbody.innerHTML = `<tr><td colspan="2" class="sin-datos">Cargando…</td></tr>`;
  const { data, error } = await sb.from("clientes_relaciones")
    .select("id,did_subcuenta,activo,lightdata_clientes(nombre_fantasia)")
    .eq("did_principal", stateRelaciones.didPrincipal)
    .order("id");
  if(error){ console.error("Error cargando relaciones:", error); tbody.innerHTML = `<tr><td colspan="2" class="sin-datos">Error cargando subcuentas vinculadas.</td></tr>`; return; }
  stateRelaciones.relaciones = (data || []).map(r => ({
    ...r,
    nombre_fantasia: Array.isArray(r.lightdata_clientes) ? r.lightdata_clientes[0]?.nombre_fantasia : r.lightdata_clientes?.nombre_fantasia,
  }));
  renderRelaciones();
}

function renderRelaciones(){
  const tbody = document.getElementById("tabla-consolidada-relaciones");
  if(!stateRelaciones.relaciones.length){
    tbody.innerHTML = `<tr><td colspan="2" class="sin-datos">Sin subcuentas vinculadas a esta cuenta principal.</td></tr>`;
    return;
  }
  tbody.innerHTML = stateRelaciones.relaciones.map(r => `
    <tr class="${r.activo ? "" : "fila-inactiva"}">
      <td>${tituloTexto(r.nombre_fantasia)}${r.activo ? "" : '<span class="badge-inactivo">Inactivo</span>'}</td>
      <td class="col-opciones">
        <span class="opciones-fila">
          <button type="button" class="btn-icono-chico borrar" data-id="${r.id}" title="Quitar vínculo"><i data-lucide="trash-2"></i></button>
        </span>
      </td>
    </tr>
  `).join("");
  lucide.createIcons();
}

export async function cargarAdminRelacionesClientes(){
  await repoblarComboPrincipalRelaciones();
  if(stateRelaciones.didPrincipal) await cargarRelaciones();
}

document.getElementById("tabla-consolidada-relaciones").addEventListener("click", (e)=>{
  const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
  if(btnBorrar){
    const id = Number(btnBorrar.dataset.id);
    mostrarConfirmacion("¿Quitar este vínculo? No borra ninguna liquidación ya generada, solo la relación.").then(async (ok)=>{
      if(!ok) return;
      const { error } = await sb.from("clientes_relaciones").delete().eq("id", id);
      if(error){ console.error("Error borrando relación:", error); await mostrarAviso("No se pudo quitar el vínculo."); return; }
      await cargarRelaciones();
    });
  }
});

// ===================== Modal "Vincular liquidaciones" (batch) =====================
// Pedido 2026-11-26 (2da vuelta): un solo flujo — elegís la cuenta
// principal, tildás TODAS las subcuentas que corresponden (ya vinculadas
// o nuevas) y Guardar aplica todo junto: activa las tildadas, desactiva
// las que estaban activas y se destildaron. Reemplaza el alta de a una.
let didPrincipalModal = null;
let activasAlAbrirModal = new Set(); // did_subcuenta ya activos para este principal, snapshot al abrir/cambiar principal

async function renderListaSubcuentasModal(){
  const cont = document.getElementById("lista-vincular-subcuentas");
  if(!didPrincipalModal){
    cont.innerHTML = `<span class="sin-datos">Elegí primero una cuenta principal.</span>`;
    return;
  }
  cont.innerHTML = `<span class="sin-datos">Cargando…</span>`;
  const { data, error } = await sb.from("clientes_relaciones")
    .select("did_subcuenta,activo")
    .eq("did_principal", didPrincipalModal);
  if(error){ console.error("Error cargando vínculos existentes:", error); cont.innerHTML = `<span class="sin-datos">Error al cargar.</span>`; return; }
  activasAlAbrirModal = new Set((data || []).filter(r => r.activo).map(r => r.did_subcuenta));
  const opciones = catalogos.clientes.filter(c => c.did !== didPrincipalModal);
  if(!opciones.length){ cont.innerHTML = `<span class="sin-datos">No hay otros clientes para vincular.</span>`; return; }
  cont.innerHTML = opciones.map(c => `
    <label class="check-columna" data-texto="${tituloTexto(nombreCliente(c)).toLowerCase()}">
      <input type="checkbox" value="${c.did}" ${activasAlAbrirModal.has(c.did) ? "checked" : ""} /> ${tituloTexto(nombreCliente(c))}
    </label>
  `).join("");
}

function abrirModalVincularLiquidaciones(){
  didPrincipalModal = stateRelaciones.didPrincipal || null;
  document.getElementById("buscar-vincular-subcuentas").value = "";
  const wrap = document.getElementById("combo-vincular-principal").parentElement;
  wrap.querySelector("#combo-vincular-principal").outerHTML = `
    <div class="combo-filtro" id="combo-vincular-principal">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${didPrincipalModal ? tituloTexto(nombreCliente(catalogos.clientes.find(c => c.did === didPrincipalModal) || {})) : "Elegir…"}</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${catalogos.clientes.map(c => `<li data-valor="${c.did}" ${c.did === didPrincipalModal ? 'aria-selected="true"' : ""}>${tituloTexto(nombreCliente(c))}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-vincular-principal", async (valor)=>{
    didPrincipalModal = Number(valor);
    await renderListaSubcuentasModal();
  });
  renderListaSubcuentasModal();
  document.getElementById("modal-vincular-liquidaciones").hidden = false;
}

document.getElementById("btn-vincular-liquidaciones").addEventListener("click", abrirModalVincularLiquidaciones);
document.getElementById("modal-vincular-cerrar").addEventListener("click", ()=>{
  document.getElementById("modal-vincular-liquidaciones").hidden = true;
});
document.getElementById("buscar-vincular-subcuentas").addEventListener("input", (e)=>{
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll("#lista-vincular-subcuentas .check-columna").forEach(lbl=>{
    lbl.hidden = q !== "" && !(lbl.dataset.texto || "").includes(q);
  });
});

document.getElementById("modal-vincular-guardar").addEventListener("click", async ()=>{
  if(!didPrincipalModal){ await mostrarAviso("Elegí una cuenta principal."); return; }
  const btn = document.getElementById("modal-vincular-guardar");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  const checks = [...document.querySelectorAll("#lista-vincular-subcuentas input[type=checkbox]")];
  const tildadas = new Set(checks.filter(c => c.checked).map(c => Number(c.value)));
  // Activar las tildadas (altas nuevas + reactivaciones) y desactivar las
  // que estaban activas y se destildaron — fila por fila, para que un
  // error puntual (ej. una subcuenta ya vinculada a OTRA principal
  // activa) no tire abajo el resto del guardado.
  const aGuardar = [
    ...[...tildadas].map(did => ({ did_subcuenta: did, activo: true })),
    ...[...activasAlAbrirModal].filter(did => !tildadas.has(did)).map(did => ({ did_subcuenta: did, activo: false })),
  ];
  const fallidas = [];
  for(const item of aGuardar){
    const { error } = await sb.from("clientes_relaciones")
      .upsert({ did_principal: didPrincipalModal, did_subcuenta: item.did_subcuenta, activo: item.activo }, { onConflict: "did_principal,did_subcuenta" });
    if(error){
      console.error("Error vinculando subcuenta:", item.did_subcuenta, error);
      const nombre = tituloTexto(nombreCliente(catalogos.clientes.find(c => c.did === item.did_subcuenta) || {}));
      fallidas.push(nombre);
    }
  }
  btn.disabled = false;
  btn.textContent = "Guardar";
  if(fallidas.length){
    await mostrarAviso(`No se pudieron vincular: ${fallidas.join(", ")} — probablemente ya están vinculadas a otra cuenta principal activa.`);
  } else {
    document.getElementById("modal-vincular-liquidaciones").hidden = true;
  }
  if(stateRelaciones.didPrincipal === didPrincipalModal) await cargarRelaciones();
});

// ===================== Pantalla "Liquidación Consolidada" (generar/consultar) =====================

const stateConsolidada = {
  didPrincipal: null,
  desde: fechaART(-6),
  hasta: fechaART(0),
  verificacion: null,
  historial: [],
};

async function repoblarComboPrincipal(){
  await asegurarCatalogoClientes();
  const wrap = document.getElementById("combo-consolidada-principal-wrap");
  const actual = stateConsolidada.didPrincipal;
  const actualTexto = actual ? tituloTexto(nombreCliente(catalogos.clientes.find(c => c.did === actual) || {})) : "Elegir cuenta principal…";
  wrap.innerHTML = `
    <div class="combo-filtro" id="combo-consolidada-principal">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${actualTexto}</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${catalogos.clientes.map(c => `<li data-valor="${c.did}" ${c.did === actual ? 'aria-selected="true"' : ""}>${tituloTexto(nombreCliente(c))}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-consolidada-principal", async (valor)=>{
    stateConsolidada.didPrincipal = Number(valor);
    stateConsolidada.verificacion = null;
    document.getElementById("consolidada-detalle-wrap").innerHTML = "";
    document.getElementById("consolidada-verificacion").innerHTML = "";
    document.getElementById("btn-consolidada-generar").disabled = true;
    await cargarHistorial();
  });
}

async function verificarSubcuentas(){
  if(!stateConsolidada.didPrincipal) return;
  const cont = document.getElementById("consolidada-verificacion");
  cont.innerHTML = `<p class="sin-datos">Verificando…</p>`;
  const { data, error } = await sb.rpc("subcuentas_para_consolidar", {
    p_did_principal: stateConsolidada.didPrincipal, p_fecha_inicio: stateConsolidada.desde, p_fecha_fin: stateConsolidada.hasta,
  });
  if(error){ console.error("Error verificando subcuentas:", error); cont.innerHTML = `<p class="sin-datos">Error al verificar.</p>`; return; }
  stateConsolidada.verificacion = data || [];
  const { data: liqPrincipal } = await sb.from("liquidaciones_clientes").select("id,estado")
    .eq("did_cliente", stateConsolidada.didPrincipal).eq("fecha_inicio", stateConsolidada.desde).eq("fecha_fin", stateConsolidada.hasta).maybeSingle();
  const principalLista = liqPrincipal && liqPrincipal.estado === "generada";
  const todasListas = principalLista && stateConsolidada.verificacion.every(s => s.liquidacion_estado === "generada");
  cont.innerHTML = `
    <ul class="lista-verificacion-consolidada">
      <li class="${principalLista ? "ok" : "falta"}"><i data-lucide="${principalLista ? "check" : "alert-triangle"}"></i>Cuenta principal: ${principalLista ? "liquidación generada" : "falta generar su liquidación individual"}</li>
      ${stateConsolidada.verificacion.map(s => `
        <li class="${s.liquidacion_estado === "generada" ? "ok" : "falta"}">
          <i data-lucide="${s.liquidacion_estado === "generada" ? "check" : "alert-triangle"}"></i>
          ${tituloTexto(s.nombre_fantasia)}: ${s.liquidacion_estado === "generada" ? "liquidación generada" : "falta generar su liquidación individual"}
        </li>
      `).join("")}
    </ul>
  `;
  lucide.createIcons();
  document.getElementById("btn-consolidada-generar").disabled = !todasListas || !stateConsolidada.verificacion.length;
}

async function generarConsolidada(){
  const btn = document.getElementById("btn-consolidada-generar");
  btn.disabled = true;
  const { data: id, error } = await sb.rpc("generar_liquidacion_consolidada", {
    p_did_principal: stateConsolidada.didPrincipal, p_fecha_inicio: stateConsolidada.desde, p_fecha_fin: stateConsolidada.hasta,
  });
  btn.disabled = false;
  if(error){ console.error("Error generando consolidada:", error); await mostrarAviso(error.message || "No se pudo generar la liquidación consolidada."); return; }
  await mostrarAviso("Liquidación consolidada generada.");
  await cargarHistorial();
  abrirDetalleConsolidada(id);
}

async function cargarHistorial(){
  const tbody = document.getElementById("tabla-consolidada-historial");
  if(!stateConsolidada.didPrincipal){ tbody.innerHTML = ""; return; }
  tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Cargando…</td></tr>`;
  const { data, error } = await sb.from("liquidaciones_consolidadas")
    .select("id,fecha_inicio,fecha_fin,estado,monto_neto")
    .eq("did_principal", stateConsolidada.didPrincipal)
    .order("fecha_inicio", { ascending: false });
  if(error){ console.error("Error cargando historial de consolidadas:", error); tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Error cargando el historial.</td></tr>`; return; }
  stateConsolidada.historial = data || [];
  if(!stateConsolidada.historial.length){
    tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Todavía no se generó ninguna liquidación consolidada para esta cuenta.</td></tr>`;
    return;
  }
  tbody.innerHTML = stateConsolidada.historial.map(c => {
    const estado = labelEstadoConsolidada(c.estado);
    return `
      <tr>
        <td>${formatearFecha(c.fecha_inicio)} a ${formatearFecha(c.fecha_fin)}</td>
        <td class="col-num">${formatearMoneda(c.monto_neto)}</td>
        <td><span class="badge-zona-detalle ${estado.clase}">${estado.texto}</span></td>
        <td class="col-opciones">
          <span class="opciones-fila">
            <button type="button" class="btn-icono-chico" data-id="${c.id}" data-accion="ver" title="Ver detalle"><i data-lucide="eye"></i></button>
          </span>
        </td>
      </tr>
    `;
  }).join("");
  lucide.createIcons();
}

document.getElementById("tabla-consolidada-historial").addEventListener("click", (e)=>{
  const btn = e.target.closest(".btn-icono-chico[data-accion='ver']");
  if(btn) abrirDetalleConsolidada(Number(btn.dataset.id));
});

async function abrirDetalleConsolidada(id){
  const wrap = document.getElementById("consolidada-detalle-wrap");
  wrap.innerHTML = `<div class="card"><p class="sin-datos">Cargando…</p></div>`;
  const { data, error } = await sb.rpc("obtener_liquidacion_consolidada", { p_id: id });
  if(error || !data || !data.length){ console.error("Error cargando consolidada:", error); wrap.innerHTML = `<div class="card"><p class="sin-datos">No se pudo cargar.</p></div>`; return; }
  const c = data[0];
  const estado = labelEstadoConsolidada(c.estado);
  const filas = c.detalle || [];
  wrap.innerHTML = `
    <div class="card">
      <div class="liq-detalle-header">
        <div class="liq-detalle-header-titulo">
          <span class="liq-detalle-titulo">Detalle consolidado — ${formatearFecha(c.fecha_inicio)} a ${formatearFecha(c.fecha_fin)}</span>
          <span class="badge-zona-detalle ${estado.clase}">${estado.texto}</span>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <span class="liquidacion-header-resumen-valor" style="color:var(--dorado); font-size:18px;">${formatearMoneda(c.monto_neto)}</span>
          ${c.estado === "generada" ? `
            <button type="button" class="btn-secundario-modal" id="btn-consolidada-anular">Anular</button>
            <button type="button" class="btn-primario" id="btn-consolidada-pagar">Marcar pagada</button>
          ` : ""}
        </div>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-detalle-liquidacion">
          <thead>
            <tr>
              <th>Cliente</th><th>Tipo</th><th class="col-num">Paquetes</th>
              <th class="col-num">Tarifa propia</th><th class="col-num">Tarifa de referencia</th>
              <th class="col-num">Importe bruto</th><th class="col-num">Diferencia</th><th class="col-num">Saldo consolidado</th>
            </tr>
          </thead>
          <tbody>
            ${filas.map(f => `
              <tr>
                <td>${tituloTexto(f.nombre_fantasia)}</td>
                <td><span class="badge-zona-detalle ${f.tipo === "principal" ? "dorado" : "gris"}">${f.tipo === "principal" ? "Principal" : "Subcuenta"}</span></td>
                <td class="col-num">${f.cantidad_paquetes ?? "—"}</td>
                <td class="col-num">${f.tarifa_propia != null ? formatearMoneda(f.tarifa_propia) : "—"}</td>
                <td class="col-num">${f.tarifa_referencia != null ? formatearMoneda(f.tarifa_referencia) : "—"}</td>
                <td class="col-num">${formatearMoneda(f.importe_bruto)}</td>
                <td class="col-num${(Number(f.diferencia) || 0) < 0 ? " monto-negativo" : ""}">${f.tipo === "principal" ? "—" : formatearMoneda(f.diferencia)}</td>
                <td class="col-num"><strong>${formatearMoneda(f.saldo_consolidado)}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  lucide.createIcons();
  if(c.estado === "generada"){
    document.getElementById("btn-consolidada-anular").addEventListener("click", async ()=>{
      if(!(await mostrarConfirmacion("¿Anular esta liquidación consolidada?"))) return;
      const { error: errAnular } = await sb.rpc("anular_liquidacion_consolidada", { p_id: id });
      if(errAnular){ await mostrarAviso(errAnular.message || "No se pudo anular."); return; }
      await cargarHistorial();
      abrirDetalleConsolidada(id);
    });
    document.getElementById("btn-consolidada-pagar").addEventListener("click", async ()=>{
      if(!(await mostrarConfirmacion("¿Marcar esta liquidación consolidada como pagada?"))) return;
      const { error: errPagar } = await sb.rpc("marcar_pagada_liquidacion_consolidada", { p_id: id });
      if(errPagar){ await mostrarAviso(errPagar.message || "No se pudo marcar como pagada."); return; }
      await cargarHistorial();
      abrirDetalleConsolidada(id);
    });
  }
}

document.getElementById("consolidada-desde").addEventListener("change", (e)=>{
  stateConsolidada.desde = e.target.value || fechaART(-6);
  stateConsolidada.verificacion = null;
  document.getElementById("consolidada-verificacion").innerHTML = "";
  document.getElementById("btn-consolidada-generar").disabled = true;
});
document.getElementById("consolidada-hasta").addEventListener("change", (e)=>{
  stateConsolidada.hasta = e.target.value || fechaART(0);
  stateConsolidada.verificacion = null;
  document.getElementById("consolidada-verificacion").innerHTML = "";
  document.getElementById("btn-consolidada-generar").disabled = true;
});
document.getElementById("consolidada-desde").value = stateConsolidada.desde;
document.getElementById("consolidada-hasta").value = stateConsolidada.hasta;
document.getElementById("btn-consolidada-verificar").addEventListener("click", verificarSubcuentas);
document.getElementById("btn-consolidada-generar").addEventListener("click", generarConsolidada);

export async function cargarLiquidacionConsolidada(){
  await repoblarComboPrincipal();
  if(stateConsolidada.didPrincipal) await cargarHistorial();
}
