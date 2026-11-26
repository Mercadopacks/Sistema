// Liquidación Consolidada (pedido 2026-11-26, 4ta vuelta — rediseño
// completo). Ya NO es algo que se "genera/anula/marca pagada": es una
// VISTA DE COMPARACIÓN EN VIVO, sin ningún registro propio — se
// recalcula cada vez que se elige cuenta principal + período, contra la
// RPC comparativa_liquidacion_consolidada() (ver migración 2026-11-26i).
//
// Objetivo: verificar el monto final que debe abonar la cuenta
// principal. Por cada celda zona×tamaño con paquetes reales, se compara
// el precio propio de cada subcuenta contra el precio de la PRINCIPAL en
// esa misma celda (su propia grilla de precios_cliente_envio — nunca un
// promedio). La diferencia de cada subcuenta se resta SIEMPRE del total
// de la principal — la subcuenta nunca ve modificado lo que paga ella.
//
// Depende de que la liquidación INDIVIDUAL de cada cuenta (principal y
// cada subcuenta) ya esté generada para el período — si a alguna le
// falta, queda marcada "Pendiente" en su lugar y no entra en el cálculo
// del monto final, pero no bloquea ver el resto (decisión confirmada con
// el usuario — ya no hay un botón "Generar" que todo-o-nada).
//
// La vinculación cuenta principal <-> subcuenta (ABM de
// clientes_relaciones) vive en Configuración (cargarAdminRelacionesClientes,
// exportada acá pero montada desde el sidebar de Configuración en
// index.html) — esta pantalla no tiene ninguna acción de administración
// de vínculos, un usuario tipo cliente (cuenta principal) también la usa.
import { sb } from "../core/supabase.js";
import { tituloTexto, formatearMoneda, formatearFecha } from "../core/formato.js";
import { crearComboGenerico, resetearCombo } from "../ui/combos.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { catalogos, nombreCliente } from "../core/catalogos.js";
import { fechaART, lunesDeSemana } from "../core/fechas.js";
import { stateSesion } from "../core/sesion.js";

function sumarDias(fechaStr, n){
  const d = new Date(fechaStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function periodoMes(fechaStr){
  const [y, m] = fechaStr.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { inicio: `${y}-${String(m).padStart(2, "0")}-01`, fin: `${y}-${String(m).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}` };
}
function periodoPara(servicio, fechaReferencia){
  return servicio === "fulfillment"
    ? periodoMes(fechaReferencia)
    : { inicio: lunesDeSemana(fechaReferencia), fin: sumarDias(lunesDeSemana(fechaReferencia), 6) };
}
const NOMBRES_MES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function labelPeriodoPara(servicio, p){
  if(servicio === "fulfillment"){
    const [y, m] = p.inicio.split("-").map(Number);
    return `${NOMBRES_MES[m - 1]} ${y}`;
  }
  return `${formatearFecha(p.inicio)} a ${formatearFecha(p.fin)}`;
}
function retrocederFechaReferencia(servicio, fechaReferencia, pasos){
  if(servicio === "fulfillment"){
    const [y, m] = fechaReferencia.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 - pasos, 15)).toISOString().slice(0, 10);
  }
  return sumarDias(fechaReferencia, -7 * pasos);
}
function esUsuarioCliente(){
  return !!(stateSesion.perfil && stateSesion.perfil.tipo_usuario === "cliente");
}

// Pedido 2026-11-26 (4ta vuelta): ya no hay estados de ciclo de vida
// (generada/pagada/anulada) — cada cuenta dentro de la comparativa solo
// puede estar "generada" (su liquidación individual ya existe, entra en
// el cálculo) o "pendiente" (todavía no se generó, se muestra igual pero
// sin números, y no afecta el monto final).
function labelEstadoCuenta(estado){
  return estado === "generada" ? { texto: "Generada", clase: "verde" } : { texto: "Pendiente", clase: "amarillo" };
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

// Pedido 2026-11-26 (3ra vuelta): se saca el selector "Elegir cuenta
// principal" de esta pantalla (no aportaba nada — había que elegirlo acá
// Y DE NUEVO adentro del modal, y si no coincidían el guardado no
// refrescaba la tabla, visto como bug real). La tabla ahora es un
// registro de CUENTAS PRINCIPALES (una fila por cada una que tiene al
// menos una subcuenta activa), con la cantidad de subcuentas vinculadas
// y una acción "Editar vínculos" que abre el mismo modal ya con esa
// cuenta y sus subcuentas tildadas.
let principalesConVinculos = [];

export async function cargarAdminRelacionesClientes(){
  await asegurarCatalogoClientes();
  const tbody = document.getElementById("tabla-consolidada-relaciones");
  tbody.innerHTML = `<tr><td colspan="3" class="sin-datos">Cargando…</td></tr>`;
  const { data, error } = await sb.from("clientes_relaciones").select("did_principal,activo");
  if(error){ console.error("Error cargando relaciones:", error); tbody.innerHTML = `<tr><td colspan="3" class="sin-datos">Error cargando: ${error.message || "revisá la consola"}.</td></tr>`; return; }
  const cantidadPorPrincipal = new Map();
  (data || []).forEach(r => {
    if(!r.activo) return;
    cantidadPorPrincipal.set(r.did_principal, (cantidadPorPrincipal.get(r.did_principal) || 0) + 1);
  });
  principalesConVinculos = [...cantidadPorPrincipal.entries()].map(([did, cantidad]) => ({
    did, cantidad, nombre_fantasia: nombreCliente(catalogos.clientes.find(c => c.did === did) || {}),
  })).sort((a, b) => a.nombre_fantasia.localeCompare(b.nombre_fantasia));
  renderPrincipalesConVinculos();
}

function renderPrincipalesConVinculos(){
  const tbody = document.getElementById("tabla-consolidada-relaciones");
  if(!principalesConVinculos.length){
    tbody.innerHTML = `<tr><td colspan="3" class="sin-datos">Sin cuentas principales vinculadas todavía — usá "Vincular liquidaciones" para crear la primera.</td></tr>`;
    return;
  }
  tbody.innerHTML = principalesConVinculos.map(p => `
    <tr>
      <td>${tituloTexto(p.nombre_fantasia)}</td>
      <td class="col-num">${p.cantidad}</td>
      <td class="col-opciones">
        <span class="opciones-fila">
          <button type="button" class="btn-icono-chico editar" data-did="${p.did}" title="Editar vínculos"><i data-lucide="pencil"></i></button>
        </span>
      </td>
    </tr>
  `).join("");
  lucide.createIcons();
}

document.getElementById("tabla-consolidada-relaciones").addEventListener("click", (e)=>{
  const btnEditar = e.target.closest(".btn-icono-chico.editar");
  if(btnEditar) abrirModalVincularLiquidaciones(Number(btnEditar.dataset.did));
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
  if(error){ console.error("Error cargando vínculos existentes:", error); cont.innerHTML = `<span class="sin-datos">Error al cargar: ${error.message || "revisá la consola"}.</span>`; return; }
  activasAlAbrirModal = new Set((data || []).filter(r => r.activo).map(r => r.did_subcuenta));
  const opciones = catalogos.clientes.filter(c => c.did !== didPrincipalModal);
  if(!opciones.length){ cont.innerHTML = `<span class="sin-datos">No hay otros clientes para vincular.</span>`; return; }
  cont.innerHTML = opciones.map(c => `
    <label class="check-columna" data-texto="${tituloTexto(nombreCliente(c)).toLowerCase()}">
      <input type="checkbox" value="${c.did}" ${activasAlAbrirModal.has(c.did) ? "checked" : ""} /> ${tituloTexto(nombreCliente(c))}
    </label>
  `).join("");
}

function abrirModalVincularLiquidaciones(didPreset){
  didPrincipalModal = didPreset || null;
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

document.getElementById("btn-vincular-liquidaciones").addEventListener("click", ()=> abrirModalVincularLiquidaciones(null));
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
  await cargarAdminRelacionesClientes();
});



// ===================== Pantalla "Liquidación Consolidada" (grilla plana en vivo) =====================
// Pedido 2026-11-26 (5ta vuelta): en vez de una tarjeta por cuenta, una
// grilla plana con buscador/filtros/paginación — mismo patrón que
// Envíos y el resto de los listados del sistema. Una fila por (cliente,
// zona, tamaño); para la cuenta PRINCIPAL, "Precio referencia"/"Total a
// ref."/"Diferencia"/"Total diferencia" quedan en "-" (no aplica
// compararla contra sí misma) — nunca $0,00 ni vacío, pedido explícito.
const GUION = "—";
function montoOGuion(v){ return v == null ? GUION : formatearMoneda(v); }

const stateConsolidada = {
  didPrincipal: null,
  servicio: "ultima_milla",
  fechaReferencia: null,
  clientes: [], // clientes disponibles para el selector de cuenta principal (admin: todos; cliente: los suyos)
};

const stateDetalleConsolidada = {
  filas: [], filtradas: [], pagina: 0, tamanoPagina: 25,
  busqueda: "", cliente: "", zona: "", tamano: "",
};

// Admin ve todas las cuentas en el selector; un usuario tipo_usuario=
// "cliente" solo ve la(s) suya(s) (mismo patrón que Mis Liquidaciones/
// Envíos) — nunca el catálogo completo.
async function resolverClientesConsolidada(){
  if(esUsuarioCliente()){
    const ids = (stateSesion.perfil && stateSesion.perfil.clientes_lightdata_ids) || [];
    if(!ids.length) return [];
    const { data, error } = await sb.from("lightdata_clientes").select("did,nombre_fantasia").in("did", ids);
    if(error){ console.error("Error cargando clientes propios:", error); return []; }
    return data || [];
  }
  await asegurarCatalogoClientes();
  return catalogos.clientes;
}

async function repoblarComboPrincipal(){
  stateConsolidada.clientes = await resolverClientesConsolidada();
  const wrap = document.getElementById("combo-consolidada-principal-wrap");
  const actual = stateConsolidada.didPrincipal;
  const actualTexto = actual ? tituloTexto(nombreCliente(stateConsolidada.clientes.find(c => c.did === actual) || {})) : "Elegir cuenta principal…";
  wrap.innerHTML = `
    <div class="combo-filtro" id="combo-consolidada-principal">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${actualTexto}</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${stateConsolidada.clientes.map(c => `<li data-valor="${c.did}" ${c.did === actual ? 'aria-selected="true"' : ""}>${tituloTexto(nombreCliente(c))}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-consolidada-principal", async (valor)=>{
    stateConsolidada.didPrincipal = Number(valor);
    stateConsolidada.servicio = "ultima_milla";
    stateConsolidada.fechaReferencia = fechaART(0);
    const { data: tipo } = await sb.rpc("tipo_servicio_cliente", { p_did_cliente: stateConsolidada.didPrincipal });
    stateConsolidada.servicio = tipo || "ultima_milla";
    repoblarComboPeriodo();
    await cargarComparativa();
  });
}

function repoblarComboPeriodo(){
  const wrap = document.getElementById("combo-consolidada-periodo-wrap");
  const ancla = fechaART(0);
  const actual = stateConsolidada.fechaReferencia;
  const opciones = [];
  for(let i = 0; i < 12; i++){
    const fecha = retrocederFechaReferencia(stateConsolidada.servicio, ancla, i);
    const texto = labelPeriodoPara(stateConsolidada.servicio, periodoPara(stateConsolidada.servicio, fecha));
    opciones.push({ valor: fecha, texto: i === 0 ? `${texto} (en curso)` : texto });
  }
  const textoActual = labelPeriodoPara(stateConsolidada.servicio, periodoPara(stateConsolidada.servicio, actual));
  wrap.innerHTML = `
    <div class="combo-filtro" id="combo-consolidada-periodo">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${textoActual}</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${opciones.map(o => `<li data-valor="${o.valor}" ${o.valor === actual ? 'aria-selected="true"' : ""}>${o.texto}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-consolidada-periodo", async (valor)=>{
    stateConsolidada.fechaReferencia = valor;
    await cargarComparativa();
  });
}

function renderResumenHeader(comparativa){
  const cont = document.getElementById("consolidada-resumen-header");
  if(!comparativa){ cont.innerHTML = ""; return; }
  const p = comparativa.principal;
  if(p.estado !== "generada"){
    cont.innerHTML = `
      <div class="tarjeta-resumen-aviso" style="margin-top:14px;">
        <i data-lucide="alert-triangle"></i><span class="tarjeta-resumen-aviso-texto">Falta generar la liquidación individual de la cuenta principal para este período — el monto final no se puede calcular todavía.</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  cont.innerHTML = `
    <div class="liquidacion-header-resumen-total" style="margin-top:14px;">
      <div class="liquidacion-header-resumen-dato">
        <span class="liquidacion-header-resumen-dato-icono"><i data-lucide="receipt"></i></span>
        <span class="liquidacion-header-resumen-dato-texto">
          <span class="liquidacion-header-resumen-label">Total a abonar (propio)</span>
          <span class="liquidacion-header-resumen-valor">${formatearMoneda(p.monto_a_pagar)}</span>
        </span>
      </div>
      <div class="liquidacion-header-resumen-dato">
        <span class="liquidacion-header-resumen-dato-icono"><i data-lucide="scale"></i></span>
        <span class="liquidacion-header-resumen-dato-texto">
          <span class="liquidacion-header-resumen-label">Total diferencias</span>
          <span class="liquidacion-header-resumen-valor">${formatearMoneda(comparativa.total_diferencias)}</span>
        </span>
      </div>
      <div class="liquidacion-header-resumen-dato liquidacion-header-resumen-destacado">
        <span class="liquidacion-header-resumen-dato-icono"><i data-lucide="circle-dollar-sign"></i></span>
        <span class="liquidacion-header-resumen-dato-texto">
          <span class="liquidacion-header-resumen-label">Total consolidado</span>
          <span class="liquidacion-header-resumen-valor">${formatearMoneda(comparativa.monto_final_principal)}</span>
        </span>
      </div>
    </div>
  `;
  lucide.createIcons();
}

function renderPendientes(comparativa){
  const cont = document.getElementById("consolidada-pendientes");
  const pendientes = [];
  if(comparativa.principal.estado !== "generada") pendientes.push(tituloTexto(nombreCliente(stateConsolidada.clientes.find(c => c.did === stateConsolidada.didPrincipal) || {})) + " (Principal)");
  (comparativa.subcuentas || []).forEach(s => { if(s.estado !== "generada") pendientes.push(tituloTexto(s.nombre_fantasia)); });
  if(!pendientes.length){ cont.hidden = true; cont.innerHTML = ""; return; }
  cont.hidden = false;
  cont.innerHTML = `
    <div class="tarjeta-resumen-aviso" style="margin-bottom:14px;">
      <i data-lucide="alert-triangle"></i><span class="tarjeta-resumen-aviso-texto">Falta generar la liquidación individual de: ${pendientes.join(", ")} — no aparecen en el detalle de abajo.</span>
    </div>
  `;
  lucide.createIcons();
}

// Aplana principal + subcuentas en filas (cliente, zona, tamaño) para la
// grilla — las cuentas "pendiente" ya se avisan aparte (renderPendientes).
function construirFilasDetalle(comparativa){
  const filas = [];
  const nombrePrincipal = tituloTexto(nombreCliente(stateConsolidada.clientes.find(c => c.did === stateConsolidada.didPrincipal) || {}));
  if(comparativa.principal.estado === "generada"){
    (comparativa.principal.filas || []).forEach(f => filas.push({
      cliente: nombrePrincipal, tipo: "principal", zona: f.zona, tamano: f.tamano, cantidad: f.cantidad,
      precio: f.precio, total: f.total, precio_referencia: null, total_referencia: null, diferencia: null, diferencia_total: null,
    }));
  }
  (comparativa.subcuentas || []).forEach(s => {
    if(s.estado !== "generada") return;
    (s.filas || []).forEach(f => filas.push({
      cliente: tituloTexto(s.nombre_fantasia), tipo: "subcuenta", zona: f.zona, tamano: f.tamano, cantidad: f.cantidad,
      precio: f.precio, total: f.total,
      precio_referencia: f.precio_referencia,
      total_referencia: f.precio_referencia != null ? f.precio_referencia * (Number(f.cantidad) || 0) : null,
      diferencia: f.precio_referencia != null ? (Number(f.precio) || 0) - f.precio_referencia : null,
      diferencia_total: f.diferencia,
    }));
  });
  return filas;
}

function aplicarFiltrosConsolidada(){
  const b = (stateDetalleConsolidada.busqueda || "").toLowerCase();
  stateDetalleConsolidada.filtradas = stateDetalleConsolidada.filas.filter(f => {
    if(b && !`${f.cliente} ${f.zona}`.toLowerCase().includes(b)) return false;
    if(stateDetalleConsolidada.cliente && f.cliente !== stateDetalleConsolidada.cliente) return false;
    if(stateDetalleConsolidada.zona && f.zona !== stateDetalleConsolidada.zona) return false;
    if(stateDetalleConsolidada.tamano && f.tamano !== stateDetalleConsolidada.tamano) return false;
    return true;
  });
  stateDetalleConsolidada.pagina = 0;
}

function renderGrillaConsolidada(){
  const tbody = document.getElementById("tabla-consolidada-detalle");
  const total = stateDetalleConsolidada.filtradas.length;
  const tam = stateDetalleConsolidada.tamanoPagina;
  const totalPaginas = Math.max(1, Math.ceil(total / tam));
  stateDetalleConsolidada.pagina = Math.min(stateDetalleConsolidada.pagina, totalPaginas - 1);
  const desde = stateDetalleConsolidada.pagina * tam;
  const pagina = stateDetalleConsolidada.filtradas.slice(desde, desde + tam);
  tbody.innerHTML = !pagina.length
    ? `<tr><td colspan="11" class="sin-datos">${total ? "Sin resultados para el filtro." : "Elegí una cuenta principal con liquidaciones generadas para este período."}</td></tr>`
    : pagina.map(f => `
        <tr>
          <td>${f.cliente}</td>
          <td><span class="badge-zona-detalle ${f.tipo === "principal" ? "dorado" : "gris"}">${f.tipo === "principal" ? "Principal" : "Subcuenta"}</span></td>
          <td>${f.zona}</td>
          <td>${f.tamano}</td>
          <td class="col-num">${f.cantidad}</td>
          <td class="col-num">${montoOGuion(f.precio)}</td>
          <td class="col-num">${montoOGuion(f.total)}</td>
          <td class="col-num${f.precio_referencia == null ? " celda-na" : ""}">${montoOGuion(f.precio_referencia)}</td>
          <td class="col-num${f.total_referencia == null ? " celda-na" : ""}">${montoOGuion(f.total_referencia)}</td>
          <td class="col-num${f.diferencia == null ? " celda-na" : (f.diferencia < 0 ? " monto-negativo" : "")}">${montoOGuion(f.diferencia)}</td>
          <td class="col-num${f.diferencia_total == null ? " celda-na" : (f.diferencia_total < 0 ? " monto-negativo" : "")}"><strong>${montoOGuion(f.diferencia_total)}</strong></td>
        </tr>
      `).join("");
  const desdeFila = total ? desde + 1 : 0;
  const hastaFila = Math.min(total, desde + tam);
  document.getElementById("consolidada-detalle-resumen").textContent =
    total ? `Mostrando ${desdeFila}–${hastaFila} de ${total} registros` : "Sin registros para este filtro.";
  document.getElementById("btn-consolidada-detalle-anterior").disabled = stateDetalleConsolidada.pagina <= 0;
  document.getElementById("btn-consolidada-detalle-siguiente").disabled = stateDetalleConsolidada.pagina >= totalPaginas - 1;
}

function repoblarFiltrosConsolidada(){
  const clientesUnicos = [...new Set(stateDetalleConsolidada.filas.map(f => f.cliente))];
  const zonasUnicas = [...new Set(stateDetalleConsolidada.filas.map(f => f.zona).filter(Boolean))];
  document.getElementById("combo-consolidada-cliente").outerHTML = `
    <div class="combo-filtro" id="combo-consolidada-cliente">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Cliente: Todos</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        <li data-valor="" aria-selected="true">Todos</li>
        ${clientesUnicos.map(c => `<li data-valor="${c}">${c}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-consolidada-cliente", (valor)=>{ stateDetalleConsolidada.cliente = valor; aplicarFiltrosConsolidada(); renderGrillaConsolidada(); });
  document.getElementById("combo-consolidada-zona").outerHTML = `
    <div class="combo-filtro" id="combo-consolidada-zona">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Zona: Todas</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        <li data-valor="" aria-selected="true">Todas</li>
        ${zonasUnicas.map(z => `<li data-valor="${z}">${z}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-consolidada-zona", (valor)=>{ stateDetalleConsolidada.zona = valor; aplicarFiltrosConsolidada(); renderGrillaConsolidada(); });
}

let filtrosConsolidadaListos = false;
function asegurarFiltrosConsolidadaListos(){
  if(filtrosConsolidadaListos) return;
  filtrosConsolidadaListos = true;
  document.getElementById("buscar-consolidada-detalle").addEventListener("input", (e)=>{
    stateDetalleConsolidada.busqueda = e.target.value.trim();
    aplicarFiltrosConsolidada();
    renderGrillaConsolidada();
  });
  crearComboGenerico("combo-consolidada-tamano", (valor)=>{ stateDetalleConsolidada.tamano = valor; aplicarFiltrosConsolidada(); renderGrillaConsolidada(); });
  crearComboGenerico("combo-consolidada-pagina", (valor)=>{ stateDetalleConsolidada.tamanoPagina = Number(valor) || 25; stateDetalleConsolidada.pagina = 0; renderGrillaConsolidada(); });
  document.getElementById("btn-consolidada-detalle-anterior").addEventListener("click", ()=>{
    if(stateDetalleConsolidada.pagina <= 0) return; stateDetalleConsolidada.pagina--; renderGrillaConsolidada();
  });
  document.getElementById("btn-consolidada-detalle-siguiente").addEventListener("click", ()=>{
    const totalPaginas = Math.max(1, Math.ceil(stateDetalleConsolidada.filtradas.length / stateDetalleConsolidada.tamanoPagina));
    if(stateDetalleConsolidada.pagina >= totalPaginas - 1) return; stateDetalleConsolidada.pagina++; renderGrillaConsolidada();
  });
}

async function cargarComparativa(){
  asegurarFiltrosConsolidadaListos();
  if(!stateConsolidada.didPrincipal){
    renderResumenHeader(null);
    document.getElementById("consolidada-pendientes").hidden = true;
    stateDetalleConsolidada.filas = []; stateDetalleConsolidada.filtradas = [];
    renderGrillaConsolidada();
    return;
  }
  document.getElementById("tabla-consolidada-detalle").innerHTML = `<tr><td colspan="11" class="sin-datos">Cargando…</td></tr>`;
  const p = periodoPara(stateConsolidada.servicio, stateConsolidada.fechaReferencia);
  const { data, error } = await sb.rpc("comparativa_liquidacion_consolidada", {
    p_did_principal: stateConsolidada.didPrincipal, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin,
  });
  if(error){
    console.error("Error cargando comparativa consolidada:", error);
    document.getElementById("tabla-consolidada-detalle").innerHTML = `<tr><td colspan="11" class="sin-datos">Error al cargar: ${error.message || "revisá la consola"}.</td></tr>`;
    renderResumenHeader(null);
    return;
  }
  renderResumenHeader(data);
  renderPendientes(data);
  stateDetalleConsolidada.busqueda = ""; stateDetalleConsolidada.cliente = ""; stateDetalleConsolidada.zona = ""; stateDetalleConsolidada.tamano = "";
  stateDetalleConsolidada.pagina = 0; stateDetalleConsolidada.tamanoPagina = 25;
  document.getElementById("buscar-consolidada-detalle").value = "";
  // "Tamaño" y "página" son combos estáticos (no se reconstruyen como
  // Cliente/Zona) — hay que resetear su estado visual a mano, si no
  // quedaban mostrando el filtro de la cuenta/período anterior aunque el
  // estado interno ya se había limpiado (mismo bug ya visto en Envíos).
  resetearCombo("combo-consolidada-tamano");
  resetearCombo("combo-consolidada-pagina");
  stateDetalleConsolidada.filas = construirFilasDetalle(data);
  repoblarFiltrosConsolidada();
  aplicarFiltrosConsolidada();
  renderGrillaConsolidada();
}

export async function cargarLiquidacionConsolidada(){
  await repoblarComboPrincipal();
  if(!stateConsolidada.fechaReferencia) stateConsolidada.fechaReferencia = fechaART(0);
  repoblarComboPeriodo();
  if(stateConsolidada.didPrincipal) await cargarComparativa();
}
