// Liquidación Clientes (períodos, resumen matriz, detalle itemizado,
// guardar/confirmar/anular) — sacado de index.html en la Etapa 7b de
// migración a ES Modules (2026-11-25).
import { sb } from "../core/supabase.js";
import { formatearFecha, formatearMoneda, parsearMoneda, tituloTexto } from "../core/formato.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { crearComboGenerico, crearPopoverGenerico } from "../ui/combos.js";
import { fechaART, lunesDeSemana } from "../core/fechas.js";
import { navegarA } from "../core/navegacion.js";

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
        <td><span class="estado-icono-fila chico ${estado.clase}" title="${estado.texto}"></span> ${estado.texto}</td>
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
    const { data, error } = await sb.rpc("calcular_totales_liquidacion_cliente", {
      p_did_cliente: did, p_fecha_inicio: p.inicio, p_fecha_fin: p.fin, p_cantidad_pallets: pallets,
    });
    if(error){ console.error("Error calculando totales de liquidación:", error); await mostrarAviso("No se pudo calcular la liquidación."); return; }
    periodo.pallets = pallets || 0;
    periodo.precioDespacho = (fila.registro && fila.registro.precio_despacho_periodo != null) ? fila.registro.precio_despacho_periodo : (data.precio_despacho_configurado || 0);
    periodo.precioDeposito = (fila.registro && fila.registro.precio_deposito_periodo != null) ? fila.registro.precio_deposito_periodo : (data.precio_deposito_configurado || 0);
    const montoDespachoOverride = ((data.cantidad_envios || 0) + (data.cantidad_turbo || 0)) * periodo.precioDespacho;
    const montoDepositoOverride = periodo.pallets * periodo.precioDeposito;
    periodo.montoTotalCalculado = data.total_envios + data.total_turbo + data.total_adicional - data.total_descuento + montoDepositoOverride + montoDespachoOverride;
    const ok = await guardarTotalesLiquidacionCliente(periodo, data, "generada");
    if(ok) cargarLiquidacionClientes();
    return;
  }

  await abrirPantallaLiquidacionCliente(periodo);
});

async function abrirPantallaLiquidacionCliente(periodo){
  liquidacionClienteAbriendo = periodo;
  navegarA("detalle-liquidacion-cliente");
  document.getElementById("detalle-liq-cliente-nombre").textContent = tituloTexto(periodo.cliente);
  document.getElementById("detalle-liq-cliente-periodo").textContent = `${labelServicio(periodo.tipo_servicio)} · ${formatearFecha(periodo.fecha_inicio)} a ${formatearFecha(periodo.fecha_fin)}`;
  document.getElementById("btn-guardar-borrador-liquidacion").hidden = !!periodo.soloLectura;
  document.getElementById("btn-confirmar-liquidacion").hidden = !!periodo.soloLectura;

  const reg = periodo.registroExistente;
  periodo.pallets = reg ? (reg.cantidad_pallets || 0) : 0;
  periodo.precioDespacho = reg && reg.precio_despacho_periodo != null ? reg.precio_despacho_periodo : null;
  periodo.precioDeposito = reg && reg.precio_deposito_periodo != null ? reg.precio_deposito_periodo : null;

  // Bug real 2026-11-24: recalcularDetalleLiquidacionCliente() (totales)
  // y cargarResumenMatrizLiquidacion() (filas) corren en paralelo, y
  // renderResumenMatrizLiquidacion() necesita AMBOS — si el RPC de
  // totales tardaba más, el de la matriz ya había intentado renderizar
  // y se cortaba en seco (`if(!periodo.totalesCalculados) return`) sin
  // que nada lo volviera a llamar: quedaba la tabla vacía para siempre.
  // Un render final (después de que las 2 terminaron) lo garantiza sin
  // importar el orden en que resuelvan.
  await Promise.all([recalcularDetalleLiquidacionCliente(), cargarResumenMatrizLiquidacion(), cargarDetalleItemizadoLiquidacion()]);
  renderResumenMatrizLiquidacion();
}

async function cargarDetalleItemizadoLiquidacion(){
  const periodo = liquidacionClienteAbriendo;
  const tbody = document.getElementById("tabla-detalle-liquidacion-cliente");
  const { data, error } = await sb.rpc("detalle_liquidacion_cliente", {
    p_did_cliente: periodo.did_cliente, p_fecha_inicio: periodo.fecha_inicio, p_fecha_fin: periodo.fecha_fin,
  });
  if(error){ console.error("Error cargando detalle de liquidación:", error); tbody.innerHTML = `<tr><td colspan="9" class="sin-datos">No se pudo cargar el detalle.</td></tr>`; return; }
  const filas = data || [];
  if(!filas.length){
    tbody.innerHTML = `<tr><td colspan="9" class="sin-datos">Sin envíos ni extras en este período.</td></tr>`;
    return;
  }
  tbody.innerHTML = filas.map((f, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${formatearFecha(f.fecha)}</td>
      <td>${f.tipo}</td>
      <td>${f.cuenta || "—"}</td>
      <td>${tituloTexto(f.direccion) || "—"}</td>
      <td>${f.localidad || "—"}</td>
      <td>${f.zona || "—"}</td>
      <td>${f.tamano || "—"}</td>
      <td>${formatearMoneda(f.monto)}</td>
    </tr>
  `).join("");
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

// Agrupa filas consecutivas del mismo "grupo" con rowspan (columna
// "Grupo" fusionada, igual al Excel de referencia) — asume que las
// filas ya vienen ordenadas por grupo (ver "order by" del RPC).
// Bug real 2026-11-24: ese rowspan hacía que las filas 2ª/3ª de cada
// grupo tuvieran MENOS <td> que la 1ª, así que cualquier CSS por
// posición (:nth-child) apuntaba a la columna equivocada — se veía
// todo corrido. Se reemplaza por completo: cada grupo es una fila
// divisoria de ancho completo (sin columna "Grupo"), seguida de sus
// filas de detalle (siempre 4 columnas, iguales) y un subtotal — formato
// estándar de liquidación por secciones, sin ambigüedad de columnas.
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

// Pedido 2026-11-24: Almacenamiento/Despacho Unitario de Fulfillment se
// arman acá (no vienen del RPC) porque su Precio (y opcionalmente su
// Cantidad, para Almacenamiento) son editables POR LIQUIDACIÓN — varían
// cada mes, no toman el precio fijo configurado en Precios por Cliente.
function renderResumenMatrizLiquidacion(){
  const periodo = liquidacionClienteAbriendo;
  if(!periodo || !periodo.matrizFilas || !periodo.totalesCalculados) return;
  const t = periodo.totalesCalculados;
  const esFulfillment = periodo.tipo_servicio === "fulfillment";
  const soloLectura = !!periodo.soloLectura;
  const cantidadPaquetesEnvios = periodo.matrizFilas
    .filter(f => f.grupo !== "Extras")
    .reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0)
    + (periodo.matrizFilas.find(f => f.item === "Turbos")?.cantidad || 0);

  if(periodo.precioDespacho == null) periodo.precioDespacho = t.precio_despacho_configurado || 0;
  if(periodo.precioDeposito == null) periodo.precioDeposito = t.precio_deposito_configurado || 0;
  const cantidadDespacho = (t.cantidad_envios || 0) + (t.cantidad_turbo || 0);
  const montoDespacho = cantidadDespacho * periodo.precioDespacho;
  const montoDeposito = periodo.pallets * periodo.precioDeposito;

  const tbody = document.getElementById("tabla-resumen-liquidacion-cliente");
  const htmlPorGrupo = agruparFilasResumen(periodo.matrizFilas).map(g => {
    const subtotal = g.filas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
    return filaSeccion(g.grupo)
      + g.filas.map(f => filaConcepto(f.item, f.cantidad, f.precio, f.monto)).join("")
      + filaSubtotal(g.grupo, subtotal);
  }).join("");
  const htmlFulfillment = !esFulfillment ? "" : (
    filaSeccion("Servicio de Fulfillment")
    + `
      <tr>
        <td class="col-concepto">Almacenamiento</td>
        <td class="col-num"><input type="number" min="0" step="1" class="cel-input" id="detalle-liq-input-pallets" value="${periodo.pallets}" ${soloLectura ? "disabled" : ""} style="width:80px; text-align:right;" /></td>
        <td class="col-num"><input type="text" class="cel-input" id="detalle-liq-input-precio-deposito" value="${formatearMoneda(periodo.precioDeposito)}" ${soloLectura ? "disabled" : ""} style="width:110px; text-align:right;" /></td>
        <td class="col-num">${formatearMoneda(montoDeposito)}</td>
      </tr>
      <tr>
        <td class="col-concepto">Despacho Unitario</td>
        <td class="col-num">${cantidadDespacho}</td>
        <td class="col-num"><input type="text" class="cel-input" id="detalle-liq-input-precio-despacho" value="${formatearMoneda(periodo.precioDespacho)}" ${soloLectura ? "disabled" : ""} style="width:110px; text-align:right;" /></td>
        <td class="col-num">${formatearMoneda(montoDespacho)}</td>
      </tr>
    `
    + filaSubtotal("Fulfillment", montoDeposito + montoDespacho)
  );
  tbody.innerHTML = htmlPorGrupo + htmlFulfillment;

  const montoTotal = t.total_envios + t.total_turbo + t.total_adicional - t.total_descuento + montoDeposito + montoDespacho;
  document.getElementById("detalle-liq-total-paquetes").textContent = cantidadPaquetesEnvios;
  document.getElementById("detalle-liq-monto-a-pagar").textContent = formatearMoneda(montoTotal);
  periodo.montoTotalCalculado = montoTotal;

  if(!soloLectura && esFulfillment){
    document.getElementById("detalle-liq-input-pallets").addEventListener("change", (e)=>{
      periodo.pallets = Number(e.target.value) || 0;
      renderResumenMatrizLiquidacion();
    });
    document.getElementById("detalle-liq-input-precio-deposito").addEventListener("change", (e)=>{
      periodo.precioDeposito = parsearMoneda(e.target.value) || 0;
      renderResumenMatrizLiquidacion();
    });
    document.getElementById("detalle-liq-input-precio-despacho").addEventListener("change", (e)=>{
      periodo.precioDespacho = parsearMoneda(e.target.value) || 0;
      renderResumenMatrizLiquidacion();
    });
  }
}

async function recalcularDetalleLiquidacionCliente(){
  const periodo = liquidacionClienteAbriendo;
  if(!periodo) return;
  // Solo lectura (ya generada): muestra los totales guardados en su
  // momento, no recalcula contra el estado actual de envíos/extras
  // (que pudo haber cambiado desde que se generó).
  if(periodo.soloLectura && periodo.registroExistente){
    periodo.totalesCalculados = periodo.registroExistente;
    return;
  }
  const { data, error } = await sb.rpc("calcular_totales_liquidacion_cliente", {
    p_did_cliente: periodo.did_cliente, p_fecha_inicio: periodo.fecha_inicio, p_fecha_fin: periodo.fecha_fin, p_cantidad_pallets: periodo.pallets,
  });
  if(error){ console.error("Error calculando totales de liquidación:", error); return; }
  periodo.totalesCalculados = data;
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
  if(!periodo || !periodo.totalesCalculados) return false;
  return guardarTotalesLiquidacionCliente(periodo, periodo.totalesCalculados, estado);
}

document.getElementById("btn-guardar-borrador-liquidacion").addEventListener("click", async ()=>{
  const btn = document.getElementById("btn-guardar-borrador-liquidacion");
  btn.disabled = true;
  const ok = await guardarLiquidacionCliente("borrador");
  btn.disabled = false;
  if(ok){
    await mostrarAviso("Borrador guardado — podés continuarlo después.");
    navegarA("liquidacion-clientes");
    cargarLiquidacionClientes();
  }
});
document.getElementById("btn-confirmar-liquidacion").addEventListener("click", async ()=>{
  if(!(await mostrarConfirmacion("¿Confirmar esta liquidación? No se puede deshacer."))) return;
  const btn = document.getElementById("btn-confirmar-liquidacion");
  btn.disabled = true;
  const ok = await guardarLiquidacionCliente("generada");
  btn.disabled = false;
  if(ok){
    navegarA("liquidacion-clientes");
    cargarLiquidacionClientes();
  }
});

export { cargarLiquidacionClientes };
