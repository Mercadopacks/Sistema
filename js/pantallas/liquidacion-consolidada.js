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
import { crearComboGenerico } from "../ui/combos.js";
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


// ===================== Pantalla "Liquidación Consolidada" (vista de comparación en vivo) =====================
// Pedido 2026-11-26 (4ta vuelta): sin botones de generar/anular/marcar
// pagada — la cabecera solo tiene cuenta principal + período, y un
// ítem destacado con el monto final a pagar. El "detalle" es, para cada
// cuenta (principal primero, después cada subcuenta), su propia grilla
// de zona×tamaño (mismo formato que Liquidación Clientes/Mis
// Liquidaciones) — a las subcuentas se les agrega una columna
// "Diferencia" contra la celda equivalente de la principal.

const stateConsolidada = {
  didPrincipal: null,
  servicio: "ultima_milla",
  fechaReferencia: null,
  clientes: [], // clientes disponibles para el selector de cuenta principal (admin: todos; cliente: los suyos)
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
          <span class="liquidacion-header-resumen-label">Monto propio de la principal</span>
          <span class="liquidacion-header-resumen-valor">${formatearMoneda(p.monto_a_pagar)}</span>
        </span>
      </div>
      <div class="liquidacion-header-resumen-dato liquidacion-header-resumen-destacado">
        <span class="liquidacion-header-resumen-dato-icono"><i data-lucide="circle-dollar-sign"></i></span>
        <span class="liquidacion-header-resumen-dato-texto">
          <span class="liquidacion-header-resumen-label">Monto total a pagar</span>
          <span class="liquidacion-header-resumen-valor">${formatearMoneda(comparativa.monto_final_principal)}</span>
        </span>
      </div>
    </div>
  `;
  lucide.createIcons();
}

// Una tarjeta por zona (igual formato que Liquidación Clientes/Mis
// Liquidaciones) — a las subcuentas se les agrega la columna
// "Diferencia" (celda a celda contra la principal).
function tarjetaZonaComparativa(zona, filas, esSubcuenta){
  const total = filas.reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0);
  const subtotal = filas.reduce((acc, f) => acc + (Number(f.total) || 0), 0);
  const diferenciaZona = filas.reduce((acc, f) => acc + (Number(f.diferencia) || 0), 0);
  return `
    <article class="tarjeta-resumen-liquidacion">
      <div class="tarjeta-resumen-header">
        <span class="tarjeta-resumen-titulo"><span class="tarjeta-resumen-bullet"></span>${zona}</span>
        <span class="tarjeta-resumen-total-chico">${total} paq.</span>
      </div>
      <table class="tabla-tarjeta-resumen${esSubcuenta ? " tabla-tarjeta-resumen-dif" : ""}">
        <thead><tr><th>Tamaño</th><th class="col-num">Cant.</th><th class="col-num">Precio</th><th class="col-num">Total</th>${esSubcuenta ? '<th class="col-num">Diferencia</th>' : ""}</tr></thead>
        <tbody>
          ${filas.map(f => `
            <tr>
              <td>${f.tamano}</td>
              <td class="col-num">${f.cantidad}</td>
              <td class="col-num">${f.precio == null ? "—" : formatearMoneda(f.precio)}</td>
              <td class="col-num">${formatearMoneda(f.total)}</td>
              ${esSubcuenta ? `<td class="col-num${(Number(f.diferencia) || 0) < 0 ? " monto-negativo" : ""}">${f.diferencia == null ? "—" : formatearMoneda(f.diferencia)}</td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="tarjeta-resumen-pie">
        <span class="tarjeta-resumen-pie-izq">Subtotal <span class="tarjeta-resumen-pie-chip">${total}</span></span>
        <span>${formatearMoneda(subtotal)}${esSubcuenta ? ` <span class="texto-muted" style="font-weight:600;">(dif. ${formatearMoneda(diferenciaZona)})</span>` : ""}</span>
      </div>
    </article>
  `;
}

function tarjetaCuenta(cuenta, esPrincipal){
  const estado = labelEstadoCuenta(cuenta.estado);
  if(cuenta.estado !== "generada"){
    return `
      <div class="card">
        <div class="liq-resumen-section-header">
          <span class="liq-resumen-section-titulo">${tituloTexto(cuenta.nombre_fantasia)}${esPrincipal ? " (Principal)" : ""}</span>
          <span class="badge-zona-detalle ${estado.clase}">${estado.texto}</span>
        </div>
        <p class="sin-datos">Todavía no se generó la liquidación individual de esta cuenta para el período elegido.</p>
      </div>
    `;
  }
  // Agrupa las filas (ya vienen ordenadas por zona desde la RPC) — mismo
  // criterio que agruparFilasResumen() de liquidacion-vista.js, pero
  // local acá porque el shape de columnas es distinto (zona/tamano en
  // vez de grupo/item).
  const porZona = [];
  (cuenta.filas || []).forEach(f => {
    const ultimo = porZona[porZona.length - 1];
    if(ultimo && ultimo.zona === f.zona) ultimo.filas.push(f);
    else porZona.push({ zona: f.zona, filas: [f] });
  });
  return `
    <div class="card">
      <div class="liq-resumen-section-header">
        <span class="liq-resumen-section-titulo">${tituloTexto(cuenta.nombre_fantasia)}${esPrincipal ? " (Principal)" : ""}</span>
        <div style="display:flex; align-items:center; gap:10px;">
          ${!esPrincipal ? `<span class="texto-muted">Diferencia total: <strong class="${(Number(cuenta.diferencia_total) || 0) < 0 ? "monto-negativo" : ""}">${formatearMoneda(cuenta.diferencia_total)}</strong></span>` : ""}
          <span class="badge-zona-detalle ${estado.clase}">${estado.texto}</span>
        </div>
      </div>
      <div class="tarjetas-resumen-liquidacion-wrap">
        <div class="tarjetas-resumen-liquidacion-fila">
          ${porZona.map(g => tarjetaZonaComparativa(g.zona, g.filas, !esPrincipal)).join("")}
        </div>
      </div>
    </div>
  `;
}

async function cargarComparativa(){
  const cont = document.getElementById("consolidada-cuentas-wrap");
  if(!stateConsolidada.didPrincipal){
    cont.innerHTML = "";
    renderResumenHeader(null);
    return;
  }
  cont.innerHTML = `<div class="card"><p class="sin-datos">Cargando…</p></div>`;
  const p = periodoPara(stateConsolidada.servicio, stateConsolidada.fechaReferencia);
  const { data, error } = await sb.rpc("comparativa_liquidacion_consolidada", {
    p_did_principal: stateConsolidada.didPrincipal, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin,
  });
  if(error){
    console.error("Error cargando comparativa consolidada:", error);
    cont.innerHTML = `<div class="card"><p class="sin-datos">Error al cargar: ${error.message || "revisá la consola"}.</p></div>`;
    renderResumenHeader(null);
    return;
  }
  renderResumenHeader(data);
  const tarjetas = [
    tarjetaCuenta({ ...data.principal, nombre_fantasia: nombreCliente(stateConsolidada.clientes.find(c => c.did === stateConsolidada.didPrincipal) || {}) }, true),
    ...(data.subcuentas || []).map(s => tarjetaCuenta(s, false)),
  ];
  cont.innerHTML = tarjetas.join("");
  lucide.createIcons();
}

export async function cargarLiquidacionConsolidada(){
  await repoblarComboPrincipal();
  if(!stateConsolidada.fechaReferencia) stateConsolidada.fechaReferencia = fechaART(0);
  repoblarComboPeriodo();
  if(stateConsolidada.didPrincipal) await cargarComparativa();
}
