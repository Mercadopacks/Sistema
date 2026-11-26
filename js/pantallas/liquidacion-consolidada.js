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

// ===================== Pantalla "Liquidación Consolidada" (cabecera única + detalle siempre visible) =====================
// Pedido 2026-11-26 (3ra vuelta): sin una card aparte para "generar" — el
// selector de cuenta principal, el de semana y el botón "Generar" viven
// en la MISMA cabecera; y en vez de un historial de corridas pasadas, la
// tabla de abajo ("Detalle de liquidaciones") siempre muestra las
// cuentas asociadas al período elegido — antes de generar, a modo de
// checklist (qué cuenta ya tiene su liquidación individual lista); después
// de generar, con los números reales ya calculados.

const stateConsolidada = {
  didPrincipal: null,
  servicio: "ultima_milla",
  fechaReferencia: null,
  clientes: [], // clientes disponibles para el selector de cuenta principal (admin: todos; cliente: los suyos)
  consolidadaActual: null, // row de liquidaciones_consolidadas para el período elegido, o null si no se generó
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
    await cargarDetalleConsolidado();
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
    await cargarDetalleConsolidado();
  });
}

function renderFilaDetalle(f){
  const esPrincipal = f.tipo === "principal";
  return `
    <tr>
      <td>${tituloTexto(f.nombre_fantasia)}</td>
      <td><span class="badge-zona-detalle ${esPrincipal ? "dorado" : "gris"}">${esPrincipal ? "Principal" : "Subcuenta"}</span></td>
      <td>${f.estadoHtml}</td>
      <td class="col-num">${f.cantidad_paquetes ?? "—"}</td>
      <td class="col-num">${f.tarifa_propia != null ? formatearMoneda(f.tarifa_propia) : "—"}</td>
      <td class="col-num">${f.tarifa_referencia != null ? formatearMoneda(f.tarifa_referencia) : "—"}</td>
      <td class="col-num">${f.importe_bruto != null ? formatearMoneda(f.importe_bruto) : "—"}</td>
      <td class="col-num${(Number(f.diferencia) || 0) < 0 ? " monto-negativo" : ""}">${esPrincipal || f.diferencia == null ? "—" : formatearMoneda(f.diferencia)}</td>
      <td class="col-num">${f.saldo_consolidado != null ? `<strong>${formatearMoneda(f.saldo_consolidado)}</strong>` : "—"}</td>
    </tr>
  `;
}

function renderResumenHeader(){
  const cont = document.getElementById("consolidada-resumen-header");
  const c = stateConsolidada.consolidadaActual;
  if(!c){ cont.innerHTML = ""; return; }
  const estado = labelEstadoConsolidada(c.estado);
  cont.innerHTML = `
    <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:14px;">
      <div class="liquidacion-header-resumen-total">
        <div class="liquidacion-header-resumen-dato">
          <span class="liquidacion-header-resumen-dato-icono"><i data-lucide="package"></i></span>
          <span class="liquidacion-header-resumen-dato-texto">
            <span class="liquidacion-header-resumen-label">Total paquetes</span>
            <span class="liquidacion-header-resumen-valor">${c.total_paquetes ?? 0}</span>
          </span>
        </div>
        <div class="liquidacion-header-resumen-dato liquidacion-header-resumen-destacado">
          <span class="liquidacion-header-resumen-dato-icono"><i data-lucide="circle-dollar-sign"></i></span>
          <span class="liquidacion-header-resumen-dato-texto">
            <span class="liquidacion-header-resumen-label">Monto neto</span>
            <span class="liquidacion-header-resumen-valor">${formatearMoneda(c.monto_neto)}</span>
          </span>
        </div>
      </div>
      <span class="badge-zona-detalle ${estado.clase}">${estado.texto}</span>
      ${c.estado === "generada" ? `
        <button type="button" class="btn-secundario-modal" id="btn-consolidada-anular">Anular</button>
        <button type="button" class="btn-primario" id="btn-consolidada-pagar">Marcar pagada</button>
      ` : ""}
    </div>
  `;
  lucide.createIcons();
  if(c.estado === "generada"){
    document.getElementById("btn-consolidada-anular").addEventListener("click", async ()=>{
      if(!(await mostrarConfirmacion("¿Anular esta liquidación consolidada?"))) return;
      const { error } = await sb.rpc("anular_liquidacion_consolidada", { p_id: c.id });
      if(error){ await mostrarAviso(error.message || "No se pudo anular."); return; }
      await cargarDetalleConsolidado();
    });
    document.getElementById("btn-consolidada-pagar").addEventListener("click", async ()=>{
      if(!(await mostrarConfirmacion("¿Marcar esta liquidación consolidada como pagada?"))) return;
      const { error } = await sb.rpc("marcar_pagada_liquidacion_consolidada", { p_id: c.id });
      if(error){ await mostrarAviso(error.message || "No se pudo marcar como pagada."); return; }
      await cargarDetalleConsolidado();
    });
  }
}

// Único punto de carga: decide solo si ya existe una consolidada
// generada para el período elegido (muestra sus números reales,
// congelados) o si todavía no (muestra el checklist de qué cuenta está
// lista para consolidar) — misma tabla en los dos casos.
async function cargarDetalleConsolidado(){
  const tbody = document.getElementById("tabla-consolidada-detalle");
  const btnGenerar = document.getElementById("btn-consolidada-generar");
  if(!stateConsolidada.didPrincipal){
    tbody.innerHTML = `<tr><td colspan="9" class="sin-datos">Elegí una cuenta principal.</td></tr>`;
    btnGenerar.disabled = true;
    stateConsolidada.consolidadaActual = null;
    renderResumenHeader();
    return;
  }
  tbody.innerHTML = `<tr><td colspan="9" class="sin-datos">Cargando…</td></tr>`;
  const p = periodoPara(stateConsolidada.servicio, stateConsolidada.fechaReferencia);

  const { data: existente, error: errExistente } = await sb.from("liquidaciones_consolidadas")
    .select("id,estado,total_paquetes,monto_neto")
    .eq("did_principal", stateConsolidada.didPrincipal).eq("fecha_inicio", p.inicio).eq("fecha_fin", p.fin)
    .neq("estado", "anulada").maybeSingle();
  if(errExistente){ console.error("Error consultando liquidación consolidada:", errExistente); tbody.innerHTML = `<tr><td colspan="9" class="sin-datos">Error al cargar: ${errExistente.message || "revisá la consola"}.</td></tr>`; return; }

  if(existente){
    const { data, error } = await sb.rpc("obtener_liquidacion_consolidada", { p_id: existente.id });
    if(error || !data || !data.length){ console.error("Error cargando consolidada:", error); tbody.innerHTML = `<tr><td colspan="9" class="sin-datos">Error al cargar: ${error?.message || "revisá la consola"}.</td></tr>`; return; }
    const c = data[0];
    stateConsolidada.consolidadaActual = c;
    const filas = (c.detalle || []).map(f => ({ ...f, estadoHtml: '<span class="badge-zona-detalle verde">Generada</span>' }));
    tbody.innerHTML = filas.map(renderFilaDetalle).join("") || `<tr><td colspan="9" class="sin-datos">Sin cuentas en esta consolidada.</td></tr>`;
    btnGenerar.disabled = true;
    renderResumenHeader();
    return;
  }

  stateConsolidada.consolidadaActual = null;
  renderResumenHeader();
  const [{ data: subcuentas, error: errSub }, { data: liqPrincipal, error: errPrincipal }] = await Promise.all([
    sb.rpc("subcuentas_para_consolidar", { p_did_principal: stateConsolidada.didPrincipal, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin }),
    sb.from("liquidaciones_clientes").select("id,estado").eq("did_cliente", stateConsolidada.didPrincipal).eq("fecha_inicio", p.inicio).eq("fecha_fin", p.fin).maybeSingle(),
  ]);
  if(errSub || errPrincipal){
    console.error("Error armando el checklist de la consolidada:", errSub || errPrincipal);
    tbody.innerHTML = `<tr><td colspan="9" class="sin-datos">Error al cargar: ${(errSub || errPrincipal).message || "revisá la consola"}.</td></tr>`;
    return;
  }
  const estadoHtml = (lista) => lista
    ? '<span class="badge-zona-detalle verde">Lista</span>'
    : '<span class="badge-zona-detalle amarillo">Falta generar su liquidación</span>';
  const principalLista = !!(liqPrincipal && liqPrincipal.estado === "generada");
  const filas = [
    { tipo: "principal", nombre_fantasia: tituloTexto(nombreCliente(stateConsolidada.clientes.find(c => c.did === stateConsolidada.didPrincipal) || {})), estadoHtml: estadoHtml(principalLista) },
    ...(subcuentas || []).map(s => ({ tipo: "subcuenta", nombre_fantasia: s.nombre_fantasia, estadoHtml: estadoHtml(s.liquidacion_estado === "generada") })),
  ];
  tbody.innerHTML = filas.map(renderFilaDetalle).join("");
  const todasListas = principalLista && (subcuentas || []).every(s => s.liquidacion_estado === "generada") && !!(subcuentas || []).length;
  btnGenerar.disabled = !todasListas;
}

async function generarConsolidada(){
  const btn = document.getElementById("btn-consolidada-generar");
  btn.disabled = true;
  const p = periodoPara(stateConsolidada.servicio, stateConsolidada.fechaReferencia);
  const { error } = await sb.rpc("generar_liquidacion_consolidada", {
    p_did_principal: stateConsolidada.didPrincipal, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin,
  });
  if(error){ console.error("Error generando consolidada:", error); await mostrarAviso(error.message || "No se pudo generar la liquidación consolidada."); btn.disabled = false; return; }
  await mostrarAviso("Liquidación consolidada generada.");
  await cargarDetalleConsolidado();
}
document.getElementById("btn-consolidada-generar").addEventListener("click", generarConsolidada);

export async function cargarLiquidacionConsolidada(){
  await repoblarComboPrincipal();
  if(!stateConsolidada.fechaReferencia) stateConsolidada.fechaReferencia = fechaART(0);
  repoblarComboPeriodo();
  if(stateConsolidada.didPrincipal) await cargarDetalleConsolidado();
}
