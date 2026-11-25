// Mis Liquidaciones: vista de SOLO LECTURA para usuarios tipo_usuario=
// "cliente" — muestra lo mismo que ve un administrativo en Liquidación
// Clientes (resumen por cordón/tamaño, detalle itemizado, estado) pero
// acotado a su(s) propio(s) did_cliente (perfiles_usuario.
// clientes_lightdata_ids), sin ninguna acción de escritura/confirmación.
// Por default aterriza en el período EN CURSO (a diferencia de la
// pantalla admin, que default-selecciona el último período cerrado) —
// pedido explícito: que el cliente vea cuánto lleva acumulado de la
// semana que se está entregando. Las 4 RPC que usa (resumen_matriz_
// liquidacion_cliente, detalle_liquidacion_cliente, calcular_totales_
// liquidacion_cliente, tipo_servicio_cliente) son SECURITY DEFINER con
// guard de autorización — ver migración
// 2026-11-25b_mis_liquidaciones_seguridad.sql — porque precios_cliente*
// está bloqueado por RLS para cualquiera que no sea admin.
import { sb } from "../core/supabase.js";
import { formatearFecha, formatearMoneda, tituloTexto } from "../core/formato.js";
import { crearComboGenerico } from "../ui/combos.js";
import { fechaART, lunesDeSemana } from "../core/fechas.js";
import { stateSesion } from "../core/sesion.js";

const stateMisLiquidaciones = { clientes: [], didActual: null, servicio: "ultima_milla", fechaReferencia: null };

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

function labelEstadoLiquidacion(estado){
  if(estado === "borrador") return { texto: "Borrador", clase: "azul" };
  if(estado === "generada") return { texto: "Generada", clase: "verde" };
  if(estado === "anulada") return { texto: "Anulada", clase: "gris" };
  return { texto: "En curso", clase: "amarillo" };
}

function agruparFilasResumen(filas){
  const grupos = [];
  filas.forEach(f => {
    const ultimo = grupos[grupos.length - 1];
    if(ultimo && ultimo.grupo === f.grupo) ultimo.filas.push(f);
    else grupos.push({ grupo: f.grupo, filas: [f] });
  });
  return grupos;
}
function filaConcepto(label, cantidad, precio, monto){
  const claseMonto = monto < 0 ? "col-num monto-negativo" : "col-num";
  return `
    <tr>
      <td class="col-concepto">${label}</td>
      <td class="col-num">${cantidad == null ? "-" : cantidad}</td>
      <td class="col-num">${precio == null ? "-" : formatearMoneda(precio)}</td>
      <td class="${claseMonto}">${formatearMoneda(monto)}</td>
    </tr>
  `;
}
function filaSeccion(nombre){
  return `<tr class="fila-seccion-liquidacion"><td colspan="4">${nombre}</td></tr>`;
}
function filaSubtotal(nombre, monto){
  const claseMonto = monto < 0 ? "col-num monto-negativo" : "col-num";
  return `<tr class="fila-subtotal-liquidacion"><td colspan="3" style="text-align:right;">Subtotal ${nombre}</td><td class="${claseMonto}">${formatearMoneda(monto)}</td></tr>`;
}

async function resolverClientesPropios(){
  const ids = (stateSesion.perfil && stateSesion.perfil.clientes_lightdata_ids) || [];
  if(!ids.length) return [];
  const { data, error } = await sb.from("lightdata_clientes").select("did,nombre_fantasia").in("did", ids);
  if(error){ console.error("Error cargando clientes propios:", error); return ids.map(did => ({ did, nombre_fantasia: `Cliente ${did}` })); }
  return data || [];
}

function repoblarComboCliente(){
  const wrap = document.getElementById("combo-mis-liquidaciones-cliente-wrap");
  if(stateMisLiquidaciones.clientes.length <= 1){ wrap.innerHTML = ""; return; }
  const actual = stateMisLiquidaciones.didActual;
  const actualNombre = tituloTexto((stateMisLiquidaciones.clientes.find(c => c.did === actual) || {}).nombre_fantasia || "");
  wrap.innerHTML = `
    <div class="combo-filtro" id="combo-mis-liquidaciones-cliente">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${actualNombre}</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${stateMisLiquidaciones.clientes.map(c => `<li data-valor="${c.did}" ${c.did === actual ? 'aria-selected="true"' : ""}>${tituloTexto(c.nombre_fantasia)}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-mis-liquidaciones-cliente", (valor)=>{
    stateMisLiquidaciones.didActual = Number(valor);
    stateMisLiquidaciones.servicio = "ultima_milla";
    stateMisLiquidaciones.fechaReferencia = fechaART(0);
    cargarDatosClienteActual();
  });
}

function repoblarComboPeriodo(){
  const wrap = document.getElementById("combo-mis-liquidaciones-periodo-wrap");
  const ancla = fechaART(0);
  const actual = stateMisLiquidaciones.fechaReferencia;
  const opciones = [];
  for(let i = 0; i < 12; i++){
    const fecha = retrocederFechaReferencia(stateMisLiquidaciones.servicio, ancla, i);
    const texto = labelPeriodoPara(stateMisLiquidaciones.servicio, periodoPara(stateMisLiquidaciones.servicio, fecha));
    opciones.push({ valor: fecha, texto: i === 0 ? `${texto} (en curso)` : texto });
  }
  const textoActual = labelPeriodoPara(stateMisLiquidaciones.servicio, periodoPara(stateMisLiquidaciones.servicio, actual));
  wrap.innerHTML = `
    <div class="combo-filtro" id="combo-mis-liquidaciones-periodo">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${textoActual}</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${opciones.map(o => `<li data-valor="${o.valor}" ${o.valor === actual ? 'aria-selected="true"' : ""}>${o.texto}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-mis-liquidaciones-periodo", (valor)=>{
    stateMisLiquidaciones.fechaReferencia = valor;
    cargarPeriodoActual();
  });
}

async function cargarDatosClienteActual(){
  const did = stateMisLiquidaciones.didActual;
  document.getElementById("mis-liq-cliente-nombre").textContent = tituloTexto((stateMisLiquidaciones.clientes.find(c => c.did === did) || {}).nombre_fantasia || "");
  const { data: tipo, error } = await sb.rpc("tipo_servicio_cliente", { p_did_cliente: did });
  if(error) console.error("Error obteniendo tipo de servicio:", error);
  stateMisLiquidaciones.servicio = tipo || "ultima_milla";
  if(!stateMisLiquidaciones.fechaReferencia) stateMisLiquidaciones.fechaReferencia = fechaART(0);
  await cargarPeriodoActual();
}

async function cargarPeriodoActual(){
  repoblarComboPeriodo();
  const did = stateMisLiquidaciones.didActual;
  const p = periodoPara(stateMisLiquidaciones.servicio, stateMisLiquidaciones.fechaReferencia);
  document.getElementById("mis-liq-periodo-label").textContent =
    `${stateMisLiquidaciones.servicio === "fulfillment" ? "Fulfillment" : "Última milla"} · ${labelPeriodoPara(stateMisLiquidaciones.servicio, p)}`;

  const tbodyResumen = document.getElementById("tabla-mis-liquidaciones-resumen");
  const tbodyDetalle = document.getElementById("tabla-mis-liquidaciones-detalle");
  tbodyResumen.innerHTML = `<tr><td colspan="4" class="sin-datos">Cargando…</td></tr>`;
  tbodyDetalle.innerHTML = `<tr><td colspan="8" class="sin-datos">Cargando…</td></tr>`;

  const [{ data: liquidacion }, { data: resumen, error: errResumen }, { data: detalle, error: errDetalle }, { data: totales, error: errTotales }] = await Promise.all([
    sb.from("liquidaciones_clientes").select("*").eq("did_cliente", did).eq("fecha_inicio", p.inicio).eq("fecha_fin", p.fin).maybeSingle(),
    sb.rpc("resumen_matriz_liquidacion_cliente", { p_did_cliente: did, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin }),
    sb.rpc("detalle_liquidacion_cliente", { p_did_cliente: did, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin }),
    sb.rpc("calcular_totales_liquidacion_cliente", { p_did_cliente: did, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin, p_cantidad_pallets: null }),
  ]);
  if(errResumen) console.error("Error cargando resumen de Mis Liquidaciones:", errResumen);
  if(errDetalle) console.error("Error cargando detalle de Mis Liquidaciones:", errDetalle);
  if(errTotales) console.error("Error cargando totales de Mis Liquidaciones:", errTotales);

  const estado = liquidacion ? liquidacion.estado : "pendiente";
  const estadoCfg = labelEstadoLiquidacion(estado);
  document.getElementById("mis-liq-estado").innerHTML = `<span class="estado-icono-fila chico ${estadoCfg.clase}"></span> ${estadoCfg.texto}`;

  const montoAPagar = (estado === "generada" && liquidacion) ? liquidacion.monto_a_pagar : (totales ? totales.monto_a_pagar : 0);
  document.getElementById("mis-liq-monto-a-pagar").textContent = formatearMoneda(montoAPagar || 0);

  const filas = resumen || [];
  tbodyResumen.innerHTML = !filas.length
    ? `<tr><td colspan="4" class="sin-datos">Sin datos para este período.</td></tr>`
    : agruparFilasResumen(filas).map(g => {
        const subtotal = g.filas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
        return filaSeccion(g.grupo) + g.filas.map(f => filaConcepto(f.item, f.cantidad, f.precio, f.monto)).join("") + filaSubtotal(g.grupo, subtotal);
      }).join("");

  const filasDetalle = detalle || [];
  tbodyDetalle.innerHTML = !filasDetalle.length
    ? `<tr><td colspan="8" class="sin-datos">Sin envíos ni extras en este período.</td></tr>`
    : filasDetalle.map((f, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${formatearFecha(f.fecha)}</td>
          <td>${f.tipo}</td>
          <td>${tituloTexto(f.direccion) || "—"}</td>
          <td>${f.localidad || "—"}</td>
          <td>${f.zona || "—"}</td>
          <td>${f.tamano || "—"}</td>
          <td>${formatearMoneda(f.monto)}</td>
        </tr>
      `).join("");
}

async function cargarMisLiquidaciones(){
  const clientes = await resolverClientesPropios();
  document.getElementById("mis-liquidaciones-sin-acceso").hidden = !!clientes.length;
  document.getElementById("mis-liquidaciones-contenido").hidden = !clientes.length;
  if(!clientes.length) return;

  stateMisLiquidaciones.clientes = clientes;
  if(!stateMisLiquidaciones.didActual || !clientes.some(c => c.did === stateMisLiquidaciones.didActual)){
    stateMisLiquidaciones.didActual = clientes[0].did;
    stateMisLiquidaciones.fechaReferencia = fechaART(0);
  }
  repoblarComboCliente();
  await cargarDatosClienteActual();
}

export { cargarMisLiquidaciones };
