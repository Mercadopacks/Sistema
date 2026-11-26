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
// Rediseño 2026-11-25: usa el mismo esqueleto compartido que Liquidación
// Clientes (encabezado unificado, tarjetas de zona dinámicas + Extras,
// detalle paginado, PDF) — ver js/ui/liquidacion-vista.js — montado SIN
// `conAcciones` (ninguna escritura).
import { sb, rpcTodasLasFilas } from "../core/supabase.js";
import { formatearFecha, formatearMoneda, tituloTexto } from "../core/formato.js";
import { crearComboGenerico } from "../ui/combos.js";
import { fechaART, lunesDeSemana } from "../core/fechas.js";
import { stateSesion } from "../core/sesion.js";
import { abmCordones } from "../admin/abm-simple.js";
import { montarVistaLiquidacion, renderResumenLiquidacion, cargarFilasDetalle, agruparFilasResumen, generarPdfLiquidacion } from "../ui/liquidacion-vista.js";

const stateMisLiquidaciones = { clientes: [], didActual: null, servicio: "ultima_milla", fechaReferencia: null };
let vistaMisLiqMontada = false;
let estadoDetalleMisLiq = null;

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

async function asegurarVistaMisLiqMontada(){
  if(vistaMisLiqMontada) return;
  vistaMisLiqMontada = true;
  await abmCordones.cargar();
  estadoDetalleMisLiq = montarVistaLiquidacion("mis-liquidaciones-contenedor", "mis-liq", {
    conAcciones: false,
    zonas: abmCordones.obtenerActivosConId().map(c => c.texto),
  });
  document.getElementById("mis-liq-btn-pdf-descargar").addEventListener("click", ()=> abrirOGenerarPdf("descargar"));
}

let ultimoPeriodoCargado = null;
async function abrirOGenerarPdf(accion){
  if(!ultimoPeriodoCargado) return;
  await generarPdfLiquidacion({ ...ultimoPeriodoCargado, accion });
}

// Pedido 2026-11-26: un usuario administrativo (tipo_usuario !==
// "cliente") entra a "Mis Liquidaciones" con acceso a TODOS los clientes
// (igual que en Liquidación Clientes) — la restricción a clientes_
// lightdata_ids solo aplica a un usuario tipo_usuario="cliente".
async function resolverClientesPropios(){
  const esAdmin = !stateSesion.perfil || stateSesion.perfil.tipo_usuario !== "cliente";
  if(esAdmin){
    const { data, error } = await sb.from("lightdata_clientes").select("did,nombre_fantasia").order("nombre_fantasia");
    if(error){ console.error("Error cargando clientes:", error); return []; }
    return data || [];
  }
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
  document.getElementById("mis-liq-nombre").textContent = tituloTexto((stateMisLiquidaciones.clientes.find(c => c.did === did) || {}).nombre_fantasia || "");
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
  document.getElementById("mis-liq-chip-servicio").textContent = stateMisLiquidaciones.servicio === "fulfillment" ? "Fulfillment" : "Última milla";
  document.getElementById("mis-liq-chip-tipo").textContent = `Liquidación ${stateMisLiquidaciones.servicio === "fulfillment" ? "Mensual" : "Semanal"}`;
  document.getElementById("mis-liq-fecha-inicio").textContent = formatearFecha(p.inicio);
  document.getElementById("mis-liq-fecha-fin").textContent = formatearFecha(p.fin);

  const [{ data: liquidacion }, { data: resumen, error: errResumen }, { data: detalle, error: errDetalle }] = await Promise.all([
    sb.from("liquidaciones_clientes").select("*").eq("did_cliente", did).eq("fecha_inicio", p.inicio).eq("fecha_fin", p.fin).maybeSingle(),
    sb.rpc("resumen_matriz_liquidacion_cliente", { p_did_cliente: did, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin }),
    rpcTodasLasFilas("detalle_liquidacion_cliente", { p_did_cliente: did, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin }),
  ]);
  if(errResumen) console.error("Error cargando resumen de Mis Liquidaciones:", errResumen);
  if(errDetalle) console.error("Error cargando detalle de Mis Liquidaciones:", errDetalle);

  const estado = liquidacion ? liquidacion.estado : "pendiente";
  const estadoCfg = labelEstadoLiquidacion(estado);
  document.getElementById("mis-liq-estado").innerHTML = `<span class="estado-icono-fila chico ${estadoCfg.clase}"></span> ${estadoCfg.texto}`;

  const filasResumen = resumen || [];
  // Bug real 2026-11-26: el monto salía de calcular_totales_liquidacion_
  // cliente(), una consulta aparte de la que arma las tarjetas — podía
  // divergir en silencio. Si ya está generada, se usa el monto guardado
  // en ese momento (liquidaciones_clientes.monto_a_pagar, histórico, no
  // se recalcula); si todavía está en curso, se suma directo de las
  // mismas filas que se ven en las tarjetas, igual que en Liquidación
  // Clientes (admin).
  const montoAPagar = (estado === "generada" && liquidacion)
    ? liquidacion.monto_a_pagar
    : filasResumen.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
  document.getElementById("mis-liq-monto-a-pagar").textContent = formatearMoneda(montoAPagar || 0);
  const cantidadPaquetes = agruparFilasResumen(filasResumen)
    .filter(g => g.grupo !== "Extras")
    .reduce((acc, g) => acc + g.filas.reduce((a, f) => a + (Number(f.cantidad) || 0), 0), 0)
    + (filasResumen.find(f => f.item === "Turbos")?.cantidad || 0);
  document.getElementById("mis-liq-total-paquetes").textContent = cantidadPaquetes;

  renderResumenLiquidacion("mis-liq", filasResumen);
  const filasDetalle = detalle || [];
  cargarFilasDetalle("mis-liq", estadoDetalleMisLiq, filasDetalle);

  ultimoPeriodoCargado = {
    cliente: (stateMisLiquidaciones.clientes.find(c => c.did === did) || {}).nombre_fantasia || "",
    servicio: stateMisLiquidaciones.servicio, fechaInicio: p.inicio, fechaFin: p.fin,
    filasResumen, filasDetalle, totalPaquetes: cantidadPaquetes, montoAPagar: montoAPagar || 0,
  };
}

async function cargarMisLiquidaciones(){
  const clientes = await resolverClientesPropios();
  document.getElementById("mis-liquidaciones-sin-acceso").hidden = !!clientes.length;
  document.getElementById("mis-liquidaciones-contenido").hidden = !clientes.length;
  if(!clientes.length) return;
  await asegurarVistaMisLiqMontada();

  stateMisLiquidaciones.clientes = clientes;
  if(!stateMisLiquidaciones.didActual || !clientes.some(c => c.did === stateMisLiquidaciones.didActual)){
    stateMisLiquidaciones.didActual = clientes[0].did;
    stateMisLiquidaciones.fechaReferencia = fechaART(0);
  }
  repoblarComboCliente();
  await cargarDatosClienteActual();
}

export { cargarMisLiquidaciones };
