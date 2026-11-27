// Liquidación Clientes (períodos, resumen matriz, detalle itemizado,
// guardar/confirmar/anular) — sacado de index.html en la Etapa 7b de
// migración a ES Modules (2026-11-25).
import { sb, rpcTodasLasFilas } from "../core/supabase.js";
import { formatearFecha, formatearMoneda, parsearMoneda, tituloTexto } from "../core/formato.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { crearComboGenerico, crearPopoverGenerico } from "../ui/combos.js";
import { fechaART, lunesDeSemana } from "../core/fechas.js";
import { navegarA } from "../core/navegacion.js";
import { abmCordones } from "../admin/abm-simple.js";
import { abrirModalAbm } from "../ui/modal-abm.js";
import { montarVistaLiquidacion, renderResumenLiquidacion, cargarFilasDetalle, generarPdfLiquidacion } from "../ui/liquidacion-vista.js";

// Bug real 2026-11-26 (seguimiento): "Monto total a pagar" y las
// tarjetas de resumen salían de 2 consultas SQL independientes
// (calcular_totales_liquidacion_cliente() y resumen_matriz_liquidacion_
// cliente()) que podían divergir en silencio — ej. un envío sin precio
// configurado para su tamaño/cordón: cuenta para una pero la otra no le
// genera ninguna fila de zona al no tener con qué cruzar. Consolidado en
// UNA sola fuente: esta función deriva TODO (lo que se ve en pantalla Y
// lo que se guarda al confirmar) de las mismas filas de resumen_matriz_
// liquidacion_cliente() — calcular_totales_liquidacion_cliente() ya NO
// se usa en esta pantalla. Colectas se suman dentro de "Adicionales" al
// persistir (liquidaciones_clientes no tiene una columna aparte para
// colectas — las tarjetas sí la muestran separada, es solo una
// distinción visual, no de almacenamiento).
function totalesDesdeMatriz(matrizFilas){
  const porItem = (nombre) => (matrizFilas || []).find(f => f.grupo === "Extras" && f.item === nombre) || { cantidad: 0, monto: 0 };
  const turbos = porItem("Turbos");
  const colectas = porItem("Colectas");
  const adicionales = porItem("Adicionales");
  const descuentos = porItem("Descuentos");
  const filasEnvios = (matrizFilas || []).filter(f => f.grupo !== "Extras");
  return {
    total_envios: filasEnvios.reduce((acc, f) => acc + (Number(f.monto) || 0), 0),
    cantidad_envios: filasEnvios.reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0),
    total_turbo: Number(turbos.monto) || 0,
    cantidad_turbo: Number(turbos.cantidad) || 0,
    total_adicional: (Number(adicionales.monto) || 0) + (Number(colectas.monto) || 0),
    cantidad_adicional: (Number(adicionales.cantidad) || 0) + (Number(colectas.cantidad) || 0),
    total_descuento: -(Number(descuentos.monto) || 0),
    cantidad_descuento: Number(descuentos.cantidad) || 0,
  };
}

// ===================== Liquidación Clientes =====================
// Pedido 2026-11-23 (3ra vuelta): primero se elige el Servicio (filtra
// qué clientes aplican, según precios_cliente.tipo_servicio), después
// el Período (semana lunes-domingo para Última Milla, mes calendario
// para Fulfillment) — la grilla muestra TODOS los clientes de ese
// servicio para ese período puntual, con su estado real (sin fila =
// Pendiente, Borrador, Generada, Anulada) y la acción que corresponde.
// Permite navegar a períodos anteriores y anular/regenerar una ya
// generada (ver migración 2026-11-23g_anular_liquidaciones.sql). Ya NO
// depende de liquidaciones_pendientes_clientes() (se arma la lista acá
// mismo comparando clientes-del-servicio vs. liquidaciones-del-período,
// más simple que la detección multi-período de antes).
const stateLiquidacionClientes = { servicio: "ultima_milla", fechaReferencia: null, busqueda: "", filtroEstado: "", filas: [] };
let liquidacionClienteAbriendo = null;

function labelServicio(t){ return t === "fulfillment" ? "Fulfillment" : "Última milla"; }

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
function periodoActual(){ return periodoPara(stateLiquidacionClientes.servicio, stateLiquidacionClientes.fechaReferencia); }
const NOMBRES_MES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function labelPeriodoPara(servicio, p){
  if(servicio === "fulfillment"){
    const [y, m] = p.inicio.split("-").map(Number);
    return `${NOMBRES_MES[m - 1]} ${y}`;
  }
  return `${formatearFecha(p.inicio)} a ${formatearFecha(p.fin)}`;
}
function fechaReferenciaDefault(servicio){
  // Default: último período YA CERRADO (semana pasada / mes pasado).
  if(servicio === "fulfillment"){
    const [y, m] = fechaART(0).split("-").map(Number);
    return new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 10);
  }
  return sumarDias(lunesDeSemana(fechaART(0)), -7);
}
function retrocederFechaReferencia(servicio, fechaReferencia, pasos){
  if(servicio === "fulfillment"){
    const [y, m] = fechaReferencia.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 - pasos, 15)).toISOString().slice(0, 10);
  }
  return sumarDias(fechaReferencia, -7 * pasos);
}
// Pedido 2026-11-24: bug real — el desplegable de período se armaba
// retrocediendo 12 pasos DESDE el último período cerrado (nunca
// incluía el período EN CURSO, todavía no cerrado), así que para un
// cliente nuevo con actividad recién este mes no había forma de
// elegirlo — la grilla se veía "sin clientes" sin que hubiera manera de
// ver el mes/semana actual. El ancla del desplegable pasa a ser el
// período en curso (hoy); el default que se SELECCIONA al entrar sigue
// siendo el último cerrado (fechaReferenciaDefault), pero ahora queda
// disponible navegar hacia el actual.
function fechaReferenciaActual(servicio){ return fechaART(0); }

// El combo de período se reconstruye entero (wrap.innerHTML + volver a
// llamar crearComboGenerico) cada vez que cambia el servicio — a
// diferencia de un combo chico (ver repoblarComboConceptoExtra), acá la
// lista es larga (12 períodos), así que no alcanza con vaciar el <ul>:
// hay que tirar también el <button> viejo, o sus listeners se acumulan
// en cada reconstrucción (bug ya visto con combos repoblados).
// El ancla del desplegable siempre es el ÚLTIMO PERÍODO CERRADO (nunca
// el período que se esté mirando en ese momento) — pedido 2026-11-24,
// bug real: si se anclaba al período seleccionado, al elegir una semana
// vieja la lista se regeneraba completa hacia atrás DESDE esa semana,
// perdiendo la posibilidad de volver a elegir semanas más nuevas.
function repoblarComboPeriodoLiquidacion(){
  const wrap = document.getElementById("combo-liquidacion-periodo-wrap");
  const ancla = fechaReferenciaActual(stateLiquidacionClientes.servicio);
  const actual = stateLiquidacionClientes.fechaReferencia;
  const opciones = [];
  for(let i = 0; i < 12; i++){
    const fecha = retrocederFechaReferencia(stateLiquidacionClientes.servicio, ancla, i);
    const texto = labelPeriodoPara(stateLiquidacionClientes.servicio, periodoPara(stateLiquidacionClientes.servicio, fecha));
    opciones.push({ valor: fecha, texto: i === 0 ? `${texto} (en curso)` : texto });
  }
  const textoActual = labelPeriodoPara(stateLiquidacionClientes.servicio, periodoPara(stateLiquidacionClientes.servicio, actual));
  wrap.innerHTML = `
    <div class="combo-filtro" id="combo-liquidacion-periodo">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${textoActual}</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${opciones.map(o => `<li data-valor="${o.valor}" ${o.valor === actual ? 'aria-selected="true"' : ""}>${o.texto}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico("combo-liquidacion-periodo", (valor)=>{
    stateLiquidacionClientes.fechaReferencia = valor;
    cargarLiquidacionClientes();
  });
}

async function cargarLiquidacionClientes(){
  if(!stateLiquidacionClientes.fechaReferencia) stateLiquidacionClientes.fechaReferencia = fechaReferenciaDefault(stateLiquidacionClientes.servicio);
  repoblarComboPeriodoLiquidacion();
  // Pedido 2026-11-24: feedback visual mientras carga (antes la grilla
  // quedaba igual y parecía que no pasaba nada al cambiar de período).
  document.getElementById("tabla-liquidacion-clientes").innerHTML = `<tr><td colspan="5" class="sin-datos">Cargando…</td></tr>`;

  const { data: clientesServicio, error: errCli } = await sb.from("precios_cliente")
    .select("did_cliente,lightdata_clientes(nombre_fantasia,codigo)")
    .eq("tipo_servicio", stateLiquidacionClientes.servicio)
    .eq("activo", true);
  if(errCli){ console.error("Error cargando clientes del servicio:", errCli); return; }

  const p = periodoActual();
  const [{ data: liquidaciones, error: errLiq }, { data: resumen, error: errResumen }] = await Promise.all([
    sb.from("liquidaciones_clientes").select("*").eq("fecha_inicio", p.inicio).eq("fecha_fin", p.fin),
    sb.rpc("resumen_liquidacion_clientes", { p_tipo_servicio: stateLiquidacionClientes.servicio, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin }),
  ]);
  if(errLiq){ console.error("Error cargando liquidaciones del período:", errLiq); return; }
  if(errResumen){ console.error("Error cargando resumen de liquidación:", errResumen); return; }
  const liquidacionesPorCliente = {};
  (liquidaciones || []).forEach(l => { liquidacionesPorCliente[l.did_cliente] = l; });
  const resumenPorCliente = {};
  (resumen || []).forEach(r => { resumenPorCliente[r.did_cliente] = r; });

  stateLiquidacionClientes.filas = (clientesServicio || [])
    .map(f => {
      const cli = Array.isArray(f.lightdata_clientes) ? f.lightdata_clientes[0] : f.lightdata_clientes;
      const registro = liquidacionesPorCliente[f.did_cliente] || null;
      const r = resumenPorCliente[f.did_cliente];
      const esGenerada = registro && registro.estado === "generada";
      return {
        did_cliente: f.did_cliente,
        // Pedido 2026-11-24: nombre limpio, sin el código adelante
        // (ese prefijo sigue usándose en combos/búsquedas de otras
        // pantallas, acá específicamente no).
        cliente: cli ? (cli.nombre_fantasia || `Cliente ${f.did_cliente}`) : "—",
        cantidadEnvios: esGenerada ? (registro.cantidad_envios + registro.cantidad_turbo) : (r ? r.cantidad_envios : 0),
        monto: esGenerada ? registro.monto_a_pagar : (r ? r.monto_estimado : 0),
        estado: registro ? registro.estado : "pendiente",
        registro,
      };
    })
    // Pedido 2026-11-24: un cliente sin liquidación generada/borrador NI
    // envíos entregados en el período no tiene nada para liquidar —no
    // debe aparecer en la grilla (antes se listaban los ~300 clientes
    // del servicio siempre, la mayoría sin nada que hacer ese período).
    .filter(f => f.registro || f.cantidadEnvios > 0);
  renderLiquidacionClientes();
}

function labelEstadoLiquidacion(estado){
  if(estado === "borrador") return { texto: "Borrador", clase: "azul" };
  if(estado === "generada") return { texto: "Generada", clase: "verde" };
  if(estado === "anulada") return { texto: "Anulada", clase: "gris" };
  return { texto: "Pendiente", clase: "amarillo" };
}

function renderLiquidacionClientes(){
  const tbody = document.getElementById("tabla-liquidacion-clientes");
  const busqueda = stateLiquidacionClientes.busqueda || "";
  const filas = stateLiquidacionClientes.filas.filter(f => {
    if(busqueda && !f.cliente.toLowerCase().includes(busqueda)) return false;
    if(stateLiquidacionClientes.filtroEstado && f.estado !== stateLiquidacionClientes.filtroEstado) return false;
    return true;
  });
  if(!filas.length){
    tbody.innerHTML = `<tr><td colspan="5" class="sin-datos">${stateLiquidacionClientes.filas.length ? "Sin resultados para la búsqueda/filtro." : "Sin clientes configurados con este tipo de servicio (ver Precios por Cliente en Configuración)."}</td></tr>`;
    return;
  }
  tbody.innerHTML = filas.map(f => {
    const estado = labelEstadoLiquidacion(f.estado);
    const acciones = f.estado === "generada"
      ? `
        <button type="button" class="btn-icono-chico" data-did="${f.did_cliente}" data-accion="ver" title="Ver"><i data-lucide="eye"></i></button>
        <button type="button" class="btn-icono-chico borrar" data-did="${f.did_cliente}" data-accion="anular" title="Anular"><i data-lucide="ban"></i></button>
      `
      : `
        <button type="button" class="btn-icono-chico" data-did="${f.did_cliente}" data-accion="ver" title="Ver"><i data-lucide="eye"></i></button>
        <button type="button" class="btn-icono-chico editar" data-did="${f.did_cliente}" data-accion="editar" title="Editar"><i data-lucide="pencil"></i></button>
        <button type="button" class="btn-icono-chico" data-did="${f.did_cliente}" data-accion="liquidar" title="Liquidar"><i data-lucide="check-check"></i></button>
      `;
    return `
      <tr>
        <td>${tituloTexto(f.cliente)}</td>
        <td>${f.cantidadEnvios}</td>
        <td>${formatearMoneda(f.monto)}</td>
        <td><span class="badge-zona-detalle ${estado.clase}">${estado.texto}</span></td>
        <td class="col-opciones"><span class="opciones-fila">${acciones}</span></td>
      </tr>
    `;
  }).join("");
  lucide.createIcons();
}

crearComboGenerico("combo-liquidacion-servicio", (valor)=>{
  stateLiquidacionClientes.servicio = valor;
  stateLiquidacionClientes.fechaReferencia = null; // recalcula el default para el nuevo servicio
  cargarLiquidacionClientes();
});
crearPopoverGenerico("popover-filtros-liquidacion-clientes");
crearComboGenerico("combo-estado-liquidacion-clientes", (valor)=>{
  stateLiquidacionClientes.filtroEstado = valor;
  renderLiquidacionClientes();
});
document.getElementById("buscar-liquidacion-clientes").addEventListener("input", (e)=>{
  stateLiquidacionClientes.busqueda = e.target.value.toLowerCase();
  renderLiquidacionClientes();
});
// Acceso directo a Extras (pedido 2026-11-24) — la pantalla de Extras
// sigue siendo su propia vista (separada por permisos, ver
// VISTAS_DISPONIBLES), este botón es solo un atajo de navegación (ya no
// tiene entrada propia en el sidebar).
document.getElementById("btn-ir-extras-liquidacion-clientes").addEventListener("click", ()=> navegarA("extras-liquidacion-clientes"));
document.getElementById("btn-ir-extras-liquidacion-repartidores").addEventListener("click", ()=> navegarA("extras-liquidacion-repartidores"));

document.getElementById("tabla-liquidacion-clientes").addEventListener("click", async (e)=>{
  const btn = e.target.closest("[data-accion]");
  if(!btn) return;
  const did = Number(btn.dataset.did);
  const accion = btn.dataset.accion;
  const fila = stateLiquidacionClientes.filas.find(f => f.did_cliente === did);
  if(!fila) return;
  const p = periodoActual();

  if(accion === "anular"){
    if(!(await mostrarConfirmacion("¿Anular esta liquidación? Vas a poder volver a generarla para este mismo período."))) return;
    const { error } = await sb.from("liquidaciones_clientes").update({ estado: "anulada" }).eq("id", fila.registro.id);
    if(error){ console.error(error); await mostrarAviso("No se pudo anular."); return; }
    cargarLiquidacionClientes();
    return;
  }

  const periodo = {
    did_cliente: did, cliente: fila.cliente, tipo_servicio: stateLiquidacionClientes.servicio,
    fecha_inicio: p.inicio, fecha_fin: p.fin,
    registroExistente: fila.registro, soloLectura: accion === "ver",
  };

  if(accion === "liquidar"){
    // Acción rápida desde la grilla, sin abrir la pantalla completa —
    // para Fulfillment hace falta la cantidad de pallets ya cargada
    // (Editar/Guardar borrador primero), no se puede inventar un 0.
    if(periodo.tipo_servicio === "fulfillment" && (!fila.registro || fila.registro.cantidad_pallets == null)){
      await mostrarAviso("Para Fulfillment hay que cargar la cantidad de pallets antes de liquidar — abrí \"Editar\" primero.");
      return;
    }
    if(!(await mostrarConfirmacion("¿Confirmar esta liquidación? No se puede deshacer."))) return;
    const pallets = periodo.tipo_servicio === "fulfillment" ? fila.registro.cantidad_pallets : null;
    const [{ data: matrizFilas, error: errMatriz }, { data: precios, error: errPrecios }] = await Promise.all([
      sb.rpc("resumen_matriz_liquidacion_cliente", { p_did_cliente: did, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin }),
      sb.from("precios_cliente").select("precio_despacho_envio,precio_deposito_pallet").eq("did_cliente", did).eq("activo", true).maybeSingle(),
    ]);
    if(errMatriz || errPrecios){ console.error("Error calculando totales de liquidación:", errMatriz || errPrecios); await mostrarAviso("No se pudo calcular la liquidación."); return; }
    const t = totalesDesdeMatriz(matrizFilas);
    periodo.pallets = pallets || 0;
    periodo.precioDespacho = (fila.registro && fila.registro.precio_despacho_periodo != null) ? fila.registro.precio_despacho_periodo : (precios?.precio_despacho_envio || 0);
    periodo.precioDeposito = (fila.registro && fila.registro.precio_deposito_periodo != null) ? fila.registro.precio_deposito_periodo : (precios?.precio_deposito_pallet || 0);
    const montoDespachoOverride = ((t.cantidad_envios || 0) + (t.cantidad_turbo || 0)) * periodo.precioDespacho;
    const montoDepositoOverride = periodo.pallets * periodo.precioDeposito;
    periodo.montoTotalCalculado = matrizFilas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0) + montoDepositoOverride + montoDespachoOverride;
    const ok = await guardarTotalesLiquidacionCliente(periodo, t, "generada");
    if(ok) cargarLiquidacionClientes();
    return;
  }

  await abrirPantallaLiquidacionCliente(periodo);
});

let vistaLiqClienteMontada = false;
let estadoDetalleLiqCliente = null;

// Monta el esqueleto compartido (header unificado + tarjetas + detalle
// paginado, ver js/ui/liquidacion-vista.js) UNA SOLA VEZ — con acciones
// de guardar/confirmar, a diferencia de Mis Liquidaciones.
async function asegurarVistaLiqClienteMontada(){
  if(vistaLiqClienteMontada) return;
  vistaLiqClienteMontada = true;
  await abmCordones.cargar();
  estadoDetalleLiqCliente = montarVistaLiquidacion("vista-detalle-liquidacion-cliente", "liq-cliente", {
    conAcciones: true,
    zonas: abmCordones.obtenerActivosConId().map(c => c.texto),
  });
  estadoDetalleLiqCliente.onEditar = abrirModalCorregirEnvio;
  document.getElementById("liq-cliente-btn-pdf-descargar").addEventListener("click", ()=> abrirOGenerarPdf("descargar"));
  document.getElementById("liq-cliente-btn-guardar-borrador").addEventListener("click", async ()=>{
    const btn = document.getElementById("liq-cliente-btn-guardar-borrador");
    btn.disabled = true;
    const ok = await guardarLiquidacionCliente("borrador");
    btn.disabled = false;
    if(ok){
      await mostrarAviso("Borrador guardado — podés continuarlo después.");
      navegarA("liquidacion-clientes");
      cargarLiquidacionClientes();
    }
  });
  document.getElementById("liq-cliente-btn-confirmar").addEventListener("click", async ()=>{
    if(!(await mostrarConfirmacion("¿Confirmar esta liquidación? No se puede deshacer."))) return;
    const btn = document.getElementById("liq-cliente-btn-confirmar");
    btn.disabled = true;
    const ok = await guardarLiquidacionCliente("generada");
    btn.disabled = false;
    if(ok){
      navegarA("liquidacion-clientes");
      cargarLiquidacionClientes();
    }
  });
}

async function abrirOGenerarPdf(accion){
  const periodo = liquidacionClienteAbriendo;
  if(!periodo || !periodo.matrizFilas) return;
  await generarPdfLiquidacion({
    cliente: periodo.cliente, servicio: periodo.tipo_servicio,
    fechaInicio: periodo.fecha_inicio, fechaFin: periodo.fecha_fin,
    filasResumen: periodo.matrizFilas, filasDetalle: periodo.detalleFilas || [],
    totalPaquetes: document.getElementById("liq-cliente-total-paquetes").textContent,
    montoAPagar: periodo.montoTotalCalculado, accion,
  });
}

async function abrirPantallaLiquidacionCliente(periodo){
  await asegurarVistaLiqClienteMontada();
  liquidacionClienteAbriendo = periodo;
  navegarA("detalle-liquidacion-cliente");
  document.getElementById("liq-cliente-nombre").textContent = tituloTexto(periodo.cliente);
  document.getElementById("liq-cliente-chip-servicio").textContent = labelServicio(periodo.tipo_servicio);
  document.getElementById("liq-cliente-chip-tipo").textContent = `Liquidación ${periodo.tipo_servicio === "fulfillment" ? "Mensual" : "Semanal"}`;
  document.getElementById("liq-cliente-fecha-inicio").textContent = formatearFecha(periodo.fecha_inicio);
  document.getElementById("liq-cliente-fecha-fin").textContent = formatearFecha(periodo.fecha_fin);
  document.getElementById("liq-cliente-estado").textContent = "";
  document.getElementById("liq-cliente-btn-guardar-borrador").hidden = !!periodo.soloLectura;
  document.getElementById("liq-cliente-btn-confirmar").hidden = !!periodo.soloLectura;
  // Corrección de Cordón/Tamaño por envío: solo con el período todavía
  // pendiente/borrador, nunca sobre una liquidación ya "generada" (eso ya
  // es un monto congelado -- ver nota en renderResumenMatrizLiquidacion).
  estadoDetalleLiqCliente.soloLectura = !!periodo.soloLectura;

  const reg = periodo.registroExistente;
  periodo.pallets = reg ? (reg.cantidad_pallets || 0) : 0;
  periodo.precioDespacho = reg && reg.precio_despacho_periodo != null ? reg.precio_despacho_periodo : null;
  periodo.precioDeposito = reg && reg.precio_deposito_periodo != null ? reg.precio_deposito_periodo : null;

  // Bug real 2026-11-24: cargarConfigPreciosLiquidacion() (precios de
  // Fulfillment) y cargarResumenMatrizLiquidacion() (filas) corren en
  // paralelo — un render final (después de que las 2 terminaron) evita
  // que uno pinte antes de que el otro esté listo, sin importar el orden
  // en que resuelvan.
  await Promise.all([cargarConfigPreciosLiquidacion(), cargarResumenMatrizLiquidacion(), cargarDetalleItemizadoLiquidacion()]);
  renderResumenMatrizLiquidacion();
}

async function cargarDetalleItemizadoLiquidacion(){
  const periodo = liquidacionClienteAbriendo;
  const { data, error } = await rpcTodasLasFilas("detalle_liquidacion_cliente", {
    p_did_cliente: periodo.did_cliente, p_fecha_inicio: periodo.fecha_inicio, p_fecha_fin: periodo.fecha_fin,
  });
  if(error){ console.error("Error cargando detalle de liquidación:", error); periodo.detalleFilas = []; }
  else periodo.detalleFilas = data || [];
  cargarFilasDetalle("liq-cliente", estadoDetalleLiqCliente, periodo.detalleFilas);
}

// Pedido 2026-11-27: corrección manual de Cordón/Tamaño de un envío
// puntual -- mitigación para envíos que llegan de Lightdata sin
// localidad/CP (no hay con qué cruzar un cordón automáticamente, ver
// fn_resolver_cordon_envio en 2026-11-23_mapeo_localidad_cordon.sql) o que
// simplemente quedaron mal clasificados. Vía RPC (corregir_cordon_tamano_
// envio, scripts/migraciones/2026-11-27_liquidacion_sin_cordon_editable.sql)
// -- `envios` sigue de solo lectura para el navegador fuera de esto.
async function abrirModalCorregirEnvio(fila){
  const periodo = liquidacionClienteAbriendo;
  if(!periodo || periodo.soloLectura) return;
  const cordonActual = abmCordones.obtenerActivosConId().find(c => c.texto === fila.zona);
  abrirModalAbm("Corregir envío", [
    { clave: "cordon_id", label: "Cordón", tipo: "select", opciones: abmCordones.obtenerActivosConId() },
    { clave: "tamano", label: "Tamaño", tipo: "select", opciones: ["Pequeño", "Mediano", "Grande"] },
  ], {
    cordon_id: cordonActual ? cordonActual.valor : "",
    tamano: fila.tamano_real || "",
  }, async (vals)=>{
    const { error } = await sb.rpc("corregir_cordon_tamano_envio", {
      p_id_interno: fila.id_interno,
      p_cordon_id: vals.cordon_id ? Number(vals.cordon_id) : null,
      p_tamano: vals.tamano || null,
    });
    if(error){ console.error("Error corrigiendo envío:", error); await mostrarAviso("No se pudo corregir el envío."); return false; }
    // Mismo Promise.all que el resto de la pantalla (ver nota en
    // abrirPantallaLiquidacionCliente): refresca tarjetas + total + detalle
    // de una, sin recargar la página.
    await Promise.all([cargarResumenMatrizLiquidacion(), cargarDetalleItemizadoLiquidacion()]);
  });
  // Pedido 2026-11-27 (seguimiento): el modal no traía ningún dato para
  // identificar DE QUÉ envío se trataba -- se agrega un bloque de solo
  // lectura (dirección/localidad/fecha/cuenta/ID venta) arriba de los
  // combos. abrirModalAbm no tiene un tipo de campo "solo texto", así que
  // se inserta a mano en el contenedor que acaba de armar, en vez de
  // tocar ese componente compartido para un caso de uso tan puntual.
  const cont = document.getElementById("modal-abm-campos");
  cont.insertAdjacentHTML("afterbegin", `
    <div class="campo-span-completo" style="margin-bottom:14px; padding:10px 12px; background:var(--fondo); border-radius:8px; font-size:13px; line-height:1.5;">
      <div><strong>${tituloTexto(fila.direccion) || "Sin dirección"}</strong>${fila.localidad ? ` · ${tituloTexto(fila.localidad)}` : ""}</div>
      <div class="texto-muted">${formatearFecha(fila.fecha)} · ${fila.cuenta || "—"}${fila.id_venta ? ` · ID Venta ${fila.id_venta}` : ""}</div>
    </div>
  `);
}

async function cargarResumenMatrizLiquidacion(){
  const periodo = liquidacionClienteAbriendo;
  const { data, error } = await sb.rpc("resumen_matriz_liquidacion_cliente", {
    p_did_cliente: periodo.did_cliente, p_fecha_inicio: periodo.fecha_inicio, p_fecha_fin: periodo.fecha_fin,
  });
  if(error){ console.error("Error cargando resumen de liquidación:", error); return; }
  periodo.matrizFilas = data || [];
  renderResumenMatrizLiquidacion();
}

// Pedido 2026-11-24: Almacenamiento/Despacho Unitario de Fulfillment se
// arman acá (no vienen del RPC) porque su Precio (y opcionalmente su
// Cantidad, para Almacenamiento) son editables POR LIQUIDACIÓN — varían
// cada mes, no toman el precio fijo configurado en Precios por Cliente.
// Rediseño 2026-11-25: las tarjetas de zona/extras las pinta el módulo
// compartido (renderResumenLiquidacion); acá solo se arma el panel
// aparte de Fulfillment (no es una tarjeta más — tiene inputs editables
// y vive siempre, tenga o no cordones configurados).
function renderResumenMatrizLiquidacion(){
  const periodo = liquidacionClienteAbriendo;
  if(!periodo || !periodo.matrizFilas) return;
  // `t` se deriva SIEMPRE de las mismas filas que ya se ven en las
  // tarjetas (totalesDesdeMatriz) — nunca de una consulta aparte, para
  // que no puedan divergir (ver nota arriba de totalesDesdeMatriz()).
  const t = totalesDesdeMatriz(periodo.matrizFilas);
  const esFulfillment = periodo.tipo_servicio === "fulfillment";
  const soloLectura = !!periodo.soloLectura;
  const cantidadPaquetesEnvios = periodo.matrizFilas
    .filter(f => f.grupo !== "Extras")
    .reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0)
    + (periodo.matrizFilas.find(f => f.item === "Turbos")?.cantidad || 0);

  if(periodo.precioDespacho == null) periodo.precioDespacho = periodo.precioDespachoConfigurado || 0;
  if(periodo.precioDeposito == null) periodo.precioDeposito = periodo.precioDepositoConfigurado || 0;
  const cantidadDespacho = (t.cantidad_envios || 0) + (t.cantidad_turbo || 0);
  const montoDespacho = cantidadDespacho * periodo.precioDespacho;
  const montoDeposito = periodo.pallets * periodo.precioDeposito;

  renderResumenLiquidacion("liq-cliente", periodo.matrizFilas);

  const contCombosExtra = document.getElementById("liq-cliente-combos-extra");
  contCombosExtra.innerHTML = !esFulfillment ? "" : `
    <div class="tarjeta-resumen-liquidacion" style="flex:0 0 auto; min-width:320px;">
      <div class="tarjeta-resumen-header"><span>Servicio de Fulfillment</span></div>
      <table class="tabla-tarjeta-resumen">
        <tbody>
          <tr>
            <td>Almacenamiento (pallets)</td>
            <td class="col-num"><input type="number" min="0" step="1" class="cel-input" id="liq-cliente-input-pallets" value="${periodo.pallets}" ${soloLectura ? "disabled" : ""} style="width:70px; text-align:right;" /></td>
            <td class="col-num"><input type="text" class="cel-input" id="liq-cliente-input-precio-deposito" value="${formatearMoneda(periodo.precioDeposito)}" ${soloLectura ? "disabled" : ""} style="width:100px; text-align:right;" /></td>
            <td class="col-num">${formatearMoneda(montoDeposito)}</td>
          </tr>
          <tr>
            <td>Despacho Unitario</td>
            <td class="col-num">${cantidadDespacho}</td>
            <td class="col-num"><input type="text" class="cel-input" id="liq-cliente-input-precio-despacho" value="${formatearMoneda(periodo.precioDespacho)}" ${soloLectura ? "disabled" : ""} style="width:100px; text-align:right;" /></td>
            <td class="col-num">${formatearMoneda(montoDespacho)}</td>
          </tr>
        </tbody>
      </table>
      <div class="tarjeta-resumen-pie"><span>Subtotal Fulfillment</span><span>${formatearMoneda(montoDeposito + montoDespacho)}</span></div>
    </div>
  `;

  // Bug real 2026-11-26: "Monto total a pagar" salía de calcular_totales_
  // liquidacion_cliente() — una consulta SQL independiente de la que arma
  // las tarjetas (resumen_matriz_liquidacion_cliente), que puede divergir
  // en silencio (ej. un envío sin precio configurado para su tamaño/
  // cordón: cuenta para calcular_totales pero resumen_matriz no genera
  // ninguna fila de zona para él, al no tener con qué cruzar). Se calcula
  // el monto SUMANDO directamente las mismas filas que ya se ven en las
  // tarjetas — así el header NUNCA puede mostrar un número distinto al
  // que da sumar lo que está en pantalla, por construcción.
  //
  // Excepción: una liquidación YA GENERADA (soloLectura) muestra el monto
  // CONGELADO que se guardó al confirmarla (liquidaciones_clientes.
  // monto_a_pagar), no uno recalculado contra el estado actual de los
  // envíos — que pudo cambiar desde que se generó (ej. un envío
  // reclasificado después). Pendiente conocido: las TARJETAS de abajo sí
  // siguen mostrando datos en vivo incluso para una ya generada (resumen_
  // matriz_liquidacion_cliente() no tiene un snapshot congelado como las
  // tablas de Liquidación Consolidada) — si cambió algo después de
  // generar, el header (correcto, histórico) puede no coincidir con las
  // tarjetas (en vivo) hasta que se le arme un snapshot propio.
  const montoTotal = (soloLectura && periodo.registroExistente)
    ? (periodo.registroExistente.monto_a_pagar || 0)
    : periodo.matrizFilas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0) + montoDeposito + montoDespacho;
  document.getElementById("liq-cliente-total-paquetes").textContent = cantidadPaquetesEnvios;
  document.getElementById("liq-cliente-monto-a-pagar").textContent = formatearMoneda(montoTotal);
  periodo.montoTotalCalculado = montoTotal;

  if(!soloLectura && esFulfillment){
    document.getElementById("liq-cliente-input-pallets").addEventListener("change", (e)=>{
      periodo.pallets = Number(e.target.value) || 0;
      renderResumenMatrizLiquidacion();
    });
    document.getElementById("liq-cliente-input-precio-deposito").addEventListener("change", (e)=>{
      periodo.precioDeposito = parsearMoneda(e.target.value) || 0;
      renderResumenMatrizLiquidacion();
    });
    document.getElementById("liq-cliente-input-precio-despacho").addEventListener("change", (e)=>{
      periodo.precioDespacho = parsearMoneda(e.target.value) || 0;
      renderResumenMatrizLiquidacion();
    });
  }
}

// Ya NO trae totales (eso sale de totalesDesdeMatriz(), ver arriba) —
// solo la config de precios de Fulfillment (despacho/depósito), que no
// está en resumen_matriz_liquidacion_cliente() porque no es un total,
// es un valor de catálogo para prellenar los inputs editables.
async function cargarConfigPreciosLiquidacion(){
  const periodo = liquidacionClienteAbriendo;
  if(!periodo || periodo.tipo_servicio !== "fulfillment") return;
  const { data, error } = await sb.from("precios_cliente")
    .select("precio_despacho_envio,precio_deposito_pallet")
    .eq("did_cliente", periodo.did_cliente).eq("activo", true).maybeSingle();
  if(error){ console.error("Error cargando precios de Fulfillment:", error); return; }
  periodo.precioDespachoConfigurado = data?.precio_despacho_envio || 0;
  periodo.precioDepositoConfigurado = data?.precio_deposito_pallet || 0;
}

async function guardarTotalesLiquidacionCliente(periodo, t, estado){
  const payload = {
    did_cliente: periodo.did_cliente, tipo_servicio: periodo.tipo_servicio,
    fecha_inicio: periodo.fecha_inicio, fecha_fin: periodo.fecha_fin,
    estado, cantidad_pallets: periodo.pallets,
    precio_despacho_periodo: periodo.precioDespacho, precio_deposito_periodo: periodo.precioDeposito,
    total_envios: t.total_envios, cantidad_envios: t.cantidad_envios,
    total_turbo: t.total_turbo, cantidad_turbo: t.cantidad_turbo,
    total_adicional: t.total_adicional, cantidad_adicional: t.cantidad_adicional,
    total_descuento: t.total_descuento, cantidad_descuento: t.cantidad_descuento,
    total_deposito: periodo.pallets * periodo.precioDeposito,
    total_despacho: ((t.cantidad_envios || 0) + (t.cantidad_turbo || 0)) * periodo.precioDespacho,
    monto_a_pagar: periodo.montoTotalCalculado,
  };
  if(estado === "generada") payload.generado_en = new Date().toISOString();
  // Upsert por (did_cliente,fecha_inicio,fecha_fin): cubre crear de cero
  // y pisar un borrador/anulada existente (continuar/regenerar) en el
  // mismo camino.
  const { error } = await sb.from("liquidaciones_clientes").upsert(payload, { onConflict: "did_cliente,fecha_inicio,fecha_fin" });
  if(error){ console.error("Error guardando liquidación:", error); await mostrarAviso("No se pudo guardar."); return false; }
  return true;
}

async function guardarLiquidacionCliente(estado){
  const periodo = liquidacionClienteAbriendo;
  if(!periodo || !periodo.matrizFilas) return false;
  return guardarTotalesLiquidacionCliente(periodo, totalesDesdeMatriz(periodo.matrizFilas), estado);
}


export { cargarLiquidacionClientes };
