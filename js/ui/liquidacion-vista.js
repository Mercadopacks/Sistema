// Vista compartida de Liquidación (tarjetas de resumen + detalle paginado
// + PDF), usada tanto por Liquidación Clientes (admin, con acciones de
// guardar/confirmar) como por Mis Liquidaciones (cliente, 100% lectura).
// Pedido 2026-11-25 (rediseño): encabezado unificado, 5+ tarjetas en fila
// (una por cordón activo + Extras — dinámico, los cordones son un ABM
// abierto, nunca asumir una cantidad fija) y detalle con buscador/
// filtros/paginación (client-side: el período de una liquidación es
// acotado, no hace falta paginar en el servidor).
import { formatearFecha, formatearMoneda, tituloTexto } from "../core/formato.js";
import { crearComboGenerico, agregarOpcionesCombo } from "./combos.js";

// ===================== Tarjetas de resumen (zonas + extras) =====================

// Agrupa filas consecutivas del mismo "grupo" (cordón, o "Extras") — las
// filas ya vienen ordenadas por grupo desde el RPC resumen_matriz_
// liquidacion_cliente.
export function agruparFilasResumen(filas){
  const grupos = [];
  (filas || []).forEach(f => {
    const ultimo = grupos[grupos.length - 1];
    if(ultimo && ultimo.grupo === f.grupo) ultimo.filas.push(f);
    else grupos.push({ grupo: f.grupo, filas: [f] });
  });
  return grupos;
}

export function filaConcepto(label, cantidad, precio, monto){
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
export function filaSeccion(nombre){
  return `<tr class="fila-seccion-liquidacion"><td colspan="4">${nombre}</td></tr>`;
}
export function filaSubtotal(nombre, monto){
  const claseMonto = monto < 0 ? "col-num monto-negativo" : "col-num";
  return `<tr class="fila-subtotal-liquidacion"><td colspan="3" style="text-align:right;">Subtotal ${nombre}</td><td class="${claseMonto}">${formatearMoneda(monto)}</td></tr>`;
}

// Tarjeta de zona (cordón): tabla Tamaño | Cant. | Precio | Total, siempre
// con las 2 categorías (Pequeños/Grandes) aunque alguna tenga cantidad 0
// (atenuada visualmente, clase "fila-sin-movimiento").
function tarjetaZona(grupo, filas){
  const total = filas.reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0);
  const subtotal = filas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
  return `
    <div class="tarjeta-resumen-liquidacion">
      <div class="tarjeta-resumen-header">
        <span>${grupo}</span>
        <span class="tarjeta-resumen-total-chico">${total} paq.</span>
      </div>
      <table class="tabla-tarjeta-resumen">
        <thead><tr><th>Tamaño</th><th class="col-num">Cant.</th><th class="col-num">Precio</th><th class="col-num">Total</th></tr></thead>
        <tbody>
          ${filas.map(f => `
            <tr class="${(Number(f.cantidad) || 0) === 0 ? "fila-sin-movimiento" : ""}">
              <td>${f.item}</td>
              <td class="col-num">${f.cantidad == null ? "-" : f.cantidad}</td>
              <td class="col-num">${f.precio == null ? "-" : formatearMoneda(f.precio)}</td>
              <td class="col-num">${formatearMoneda(f.monto)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="tarjeta-resumen-pie">
        <span>Subtotal</span>
        <span>${total} paq. — ${formatearMoneda(subtotal)}</span>
      </div>
    </div>
  `;
}

// Tarjeta de Extras: Concepto | Cant. | Importe (Turbos/Colectas/
// Adicionales/Descuentos).
function tarjetaExtras(filas){
  const subtotal = filas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
  return `
    <div class="tarjeta-resumen-liquidacion">
      <div class="tarjeta-resumen-header"><span>Extras</span></div>
      <table class="tabla-tarjeta-resumen">
        <thead><tr><th>Concepto</th><th class="col-num">Cant.</th><th class="col-num">Importe</th></tr></thead>
        <tbody>
          ${filas.map(f => `
            <tr>
              <td>${f.item}</td>
              <td class="col-num">${f.cantidad == null ? "-" : f.cantidad}</td>
              <td class="col-num${(Number(f.monto) || 0) < 0 ? " monto-negativo" : ""}">${formatearMoneda(f.monto)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="tarjeta-resumen-pie">
        <span>Subtotal Extras</span>
        <span>${formatearMoneda(subtotal)}</span>
      </div>
    </div>
  `;
}

// Pinta la fila de tarjetas (zonas dinámicas + Extras) en el contenedor
// `${prefijo}-tarjetas`, y la tabla "clásica" de resumen (secciones +
// subtotales) en `${prefijo}-tabla-resumen` para quien la siga usando.
export function renderResumenLiquidacion(prefijo, filasResumen){
  const grupos = agruparFilasResumen(filasResumen || []);
  const contTarjetas = document.getElementById(`${prefijo}-tarjetas`);
  if(contTarjetas){
    contTarjetas.innerHTML = grupos.map(g => g.grupo === "Extras" ? tarjetaExtras(g.filas) : tarjetaZona(g.grupo, g.filas)).join("");
  }
  const tbody = document.getElementById(`${prefijo}-tabla-resumen`);
  if(tbody){
    tbody.innerHTML = !grupos.length
      ? `<tr><td colspan="4" class="sin-datos">Sin datos para este período.</td></tr>`
      : grupos.map(g => {
          const subtotal = g.filas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
          return filaSeccion(g.grupo) + g.filas.map(f => filaConcepto(f.item, f.cantidad, f.precio, f.monto)).join("") + filaSubtotal(g.grupo, subtotal);
        }).join("");
  }
}

// ===================== Detalle: buscador + filtros + paginación (client-side) =====================

const COLUMNAS_DETALLE = ["Nro", "Fecha", "Tipo", "Cuenta", "Dirección", "Localidad", "Zona", "Tamaño", "Monto"];

export function crearEstadoDetalle(){
  return {
    filas: [], filtradas: [], pagina: 0, tamanoPagina: 25,
    busqueda: "", desde: "", hasta: "", zona: "", tamano: "",
  };
}

function aplicarFiltros(estado){
  const b = (estado.busqueda || "").toLowerCase();
  estado.filtradas = estado.filas.filter(f => {
    if(b){
      const texto = `${f.direccion || ""} ${f.localidad || ""} ${f.cuenta || ""}`.toLowerCase();
      if(!texto.includes(b)) return false;
    }
    if(estado.desde && f.fecha && f.fecha < estado.desde) return false;
    if(estado.hasta && f.fecha && f.fecha > estado.hasta) return false;
    if(estado.zona && f.zona !== estado.zona) return false;
    if(estado.tamano && f.tamano !== estado.tamano) return false;
    return true;
  });
  estado.pagina = 0;
}

function renderDetalle(prefijo, estado){
  const tbody = document.getElementById(`${prefijo}-tabla-detalle`);
  const total = estado.filtradas.length;
  const tam = estado.tamanoPagina;
  const totalPaginas = Math.max(1, Math.ceil(total / tam));
  estado.pagina = Math.min(estado.pagina, totalPaginas - 1);
  const desde = estado.pagina * tam;
  const pagina = estado.filtradas.slice(desde, desde + tam);
  tbody.innerHTML = !pagina.length
    ? `<tr><td colspan="9" class="sin-datos">${total ? "Sin resultados para el filtro." : "Sin envíos ni extras en este período."}</td></tr>`
    : pagina.map((f, i) => `
        <tr>
          <td>${desde + i + 1}</td>
          <td>${formatearFecha(f.fecha)}</td>
          <td>${f.tipo}</td>
          <td>${f.cuenta || "—"}</td>
          <td>${tituloTexto(f.direccion) || "—"}</td>
          <td>${tituloTexto(f.localidad) || "—"}</td>
          <td>${f.zona || "—"}</td>
          <td>${f.tamano || "—"}</td>
          <td class="col-num">${formatearMoneda(f.monto)}</td>
        </tr>
      `).join("");
  const desdeFila = total ? desde + 1 : 0;
  const hastaFila = Math.min(total, desde + tam);
  document.getElementById(`${prefijo}-detalle-resumen`).textContent =
    total ? `Mostrando ${desdeFila}–${hastaFila} de ${total} registros` : "Sin registros para este filtro.";
  document.getElementById(`${prefijo}-btn-detalle-anterior`).disabled = estado.pagina <= 0;
  document.getElementById(`${prefijo}-btn-detalle-siguiente`).disabled = estado.pagina >= totalPaginas - 1;
  const btnLimpiar = document.getElementById(`${prefijo}-btn-detalle-limpiar`);
  const hayFiltro = !!(estado.busqueda || estado.desde || estado.hasta || estado.zona || estado.tamano);
  btnLimpiar.hidden = !hayFiltro;
}

// Carga filas nuevas (al cambiar de período/cliente) — resetea filtros y
// paginación.
export function cargarFilasDetalle(prefijo, estado, filas){
  estado.filas = filas || [];
  estado.busqueda = ""; estado.desde = ""; estado.hasta = ""; estado.zona = ""; estado.tamano = "";
  const buscador = document.getElementById(`${prefijo}-detalle-buscar`);
  if(buscador) buscador.value = "";
  const df = document.getElementById(`${prefijo}-detalle-desde`); if(df) df.value = "";
  const dh = document.getElementById(`${prefijo}-detalle-hasta`); if(dh) dh.value = "";
  aplicarFiltros(estado);
  renderDetalle(prefijo, estado);
}

// Engancha los controles UNA SOLA VEZ (se llama desde montarVistaLiquidacion).
function vincularDetalle(prefijo, estado, zonasDisponibles){
  let debounce = null;
  document.getElementById(`${prefijo}-detalle-buscar`).addEventListener("input", (e)=>{
    estado.busqueda = e.target.value.trim();
    clearTimeout(debounce);
    debounce = setTimeout(()=>{ aplicarFiltros(estado); renderDetalle(prefijo, estado); }, 300);
  });
  document.getElementById(`${prefijo}-detalle-desde`).addEventListener("change", (e)=>{
    estado.desde = e.target.value || ""; aplicarFiltros(estado); renderDetalle(prefijo, estado);
  });
  document.getElementById(`${prefijo}-detalle-hasta`).addEventListener("change", (e)=>{
    estado.hasta = e.target.value || ""; aplicarFiltros(estado); renderDetalle(prefijo, estado);
  });
  // `agregarOpcionesCombo` SIEMPRE antes de `crearComboGenerico` para ese
  // mismo combo: los listeners de cada <li> se enganchan una sola vez al
  // crearse el combo, así que un <li> agregado después quedaría sin click.
  if(zonasDisponibles && zonasDisponibles.length){
    agregarOpcionesCombo(`${prefijo}-combo-zona`, zonasDisponibles.map(z => ({ valor: z, texto: z })));
  }
  crearComboGenerico(`${prefijo}-combo-zona`, (valor)=>{ estado.zona = valor; aplicarFiltros(estado); renderDetalle(prefijo, estado); });
  crearComboGenerico(`${prefijo}-combo-tamano`, (valor)=>{ estado.tamano = valor; aplicarFiltros(estado); renderDetalle(prefijo, estado); });
  crearComboGenerico(`${prefijo}-combo-pagina`, (valor)=>{ estado.tamanoPagina = Number(valor) || 25; estado.pagina = 0; renderDetalle(prefijo, estado); });
  document.getElementById(`${prefijo}-btn-detalle-anterior`).addEventListener("click", ()=>{
    if(estado.pagina <= 0) return; estado.pagina--; renderDetalle(prefijo, estado);
  });
  document.getElementById(`${prefijo}-btn-detalle-siguiente`).addEventListener("click", ()=>{
    const totalPaginas = Math.max(1, Math.ceil(estado.filtradas.length / estado.tamanoPagina));
    if(estado.pagina >= totalPaginas - 1) return; estado.pagina++; renderDetalle(prefijo, estado);
  });
  document.getElementById(`${prefijo}-btn-detalle-limpiar`).addEventListener("click", ()=>{
    cargarFilasDetalle(prefijo, estado, estado.filas);
  });
}

// ===================== Esqueleto de la pantalla (header + tarjetas + detalle) =====================

// `opciones.conAcciones` agrega el footer de Guardar borrador/Confirmar
// liquidación (Liquidación Clientes admin); Mis Liquidaciones no lo pasa.
export function montarVistaLiquidacion(contenedorId, prefijo, opciones){
  opciones = opciones || {};
  const cont = document.getElementById(contenedorId);
  cont.innerHTML = `
    <div class="card">
      <div class="liquidacion-header-unificado">
        <div class="liquidacion-header-datos">
          <h3 id="${prefijo}-nombre" style="margin:0;"></h3>
          <span class="texto-muted" id="${prefijo}-periodo"></span>
          <span id="${prefijo}-estado"></span>
        </div>
        <div class="liquidacion-header-resumen">
          <div class="liquidacion-header-resumen-dato">
            <span class="liquidacion-header-resumen-label">Paquetes</span>
            <span class="liquidacion-header-resumen-valor" id="${prefijo}-total-paquetes">—</span>
          </div>
          <div class="liquidacion-header-resumen-dato liquidacion-header-resumen-destacado">
            <span class="liquidacion-header-resumen-label">Monto a pagar</span>
            <span class="liquidacion-header-resumen-valor" id="${prefijo}-monto-a-pagar">—</span>
          </div>
          <button type="button" class="btn-icono" id="${prefijo}-btn-pdf-vista" data-tip="Vista previa PDF"><i data-lucide="eye"></i></button>
          <button type="button" class="btn-icono" id="${prefijo}-btn-pdf-descargar" data-tip="Descargar PDF"><i data-lucide="download"></i></button>
        </div>
      </div>
      <div id="${prefijo}-combos-extra" class="buscar-mas-filtrar" style="margin-bottom:10px;"></div>
      <div class="tarjetas-resumen-liquidacion-fila" id="${prefijo}-tarjetas"></div>
      <p style="font-weight:700; margin:20px 0 8px;">Detalle de envíos</p>
      <div class="buscar-mas-filtrar" style="margin-bottom:10px;">
        <input id="${prefijo}-detalle-buscar" class="buscador" placeholder="Buscar por dirección, localidad o cuenta…" />
        <span class="rango-fechas-envios-listado">
          <input type="date" id="${prefijo}-detalle-desde" />
          <span style="color:#777;">a</span>
          <input type="date" id="${prefijo}-detalle-hasta" />
        </span>
        <div class="combo-filtro" id="${prefijo}-combo-zona">
          <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Zona</button>
          <ul class="combo-filtro-lista" role="listbox" hidden><li data-valor="" aria-selected="true">Todas</li></ul>
        </div>
        <div class="combo-filtro" id="${prefijo}-combo-tamano">
          <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Tamaño</button>
          <ul class="combo-filtro-lista" role="listbox" hidden>
            <li data-valor="" aria-selected="true">Todos</li>
            <li data-valor="Pequeños">Pequeños</li>
            <li data-valor="Grandes">Grandes</li>
          </ul>
        </div>
        <button type="button" class="btn-filtrar" id="${prefijo}-btn-detalle-limpiar" hidden><i data-lucide="x"></i>Limpiar filtros</button>
      </div>
      <div class="tabla-scroll">
        <table class="tabla-detalle-liquidacion">
          <thead><tr>${COLUMNAS_DETALLE.map((c, i) => `<th${i === 0 || i === 8 ? ' class="col-num"' : ""}>${c}</th>`).join("")}</tr></thead>
          <tbody id="${prefijo}-tabla-detalle"></tbody>
        </table>
      </div>
      <div class="paginacion-envios-listado">
        <span id="${prefijo}-detalle-resumen" class="texto-muted"></span>
        <div class="paginacion-controles">
          <div class="combo-filtro" id="${prefijo}-combo-pagina">
            <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">25 / pág.</button>
            <ul class="combo-filtro-lista" role="listbox" hidden>
              <li data-valor="25" aria-selected="true">25 / pág.</li>
              <li data-valor="50">50 / pág.</li>
              <li data-valor="100">100 / pág.</li>
            </ul>
          </div>
          <button type="button" class="btn-icono" id="${prefijo}-btn-detalle-anterior"><i data-lucide="chevron-left"></i></button>
          <button type="button" class="btn-icono" id="${prefijo}-btn-detalle-siguiente"><i data-lucide="chevron-right"></i></button>
        </div>
      </div>
      ${opciones.conAcciones ? `
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
          <button type="button" class="btn-secundario-modal" id="${prefijo}-btn-guardar-borrador" hidden>Guardar borrador</button>
          <button type="button" class="btn-primario" id="${prefijo}-btn-confirmar" hidden>Confirmar liquidación</button>
        </div>
      ` : ""}
    </div>
  `;
  const estadoDetalle = crearEstadoDetalle();
  vincularDetalle(prefijo, estadoDetalle, opciones.zonas);
  lucide.createIcons();
  return estadoDetalle;
}

// ===================== PDF =====================

const NOMBRES_MES_PDF = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// Arma el detalle diario agregado (Fecha x Zona x Tamaño) a partir del
// detalle itemizado YA CARGADO en pantalla (pedido explícito: el PDF sale
// de los datos que se tienen en pantalla, no de un cálculo nuevo).
// Simplificaciones documentadas (no hay datos para más que esto hoy):
// "Colectas" y "Observaciones" por día no están disponibles en el detalle
// itemizado (son datos de período, no por envío) — quedan en 0/vacío acá;
// si hace falta ese detalle día por día habría que extenderlo aparte.
function armarDetalleDiarioPdf(filasDetalle, zonas){
  const porFecha = new Map();
  for(const f of filasDetalle){
    if(!f.fecha) continue;
    if(!porFecha.has(f.fecha)) porFecha.set(f.fecha, { fecha: f.fecha, porZonaTamano: {}, turbo: 0, adicional: 0 });
    const reg = porFecha.get(f.fecha);
    if(f.tipo === "Envío"){
      const clave = `${f.zona || ""}|${f.tamano || ""}`;
      reg.porZonaTamano[clave] = (reg.porZonaTamano[clave] || 0) + 1;
    } else if(f.tipo === "Turbo"){
      reg.turbo += 1;
    } else {
      // Adicional/Descuento (lo que no sea Envío/Turbo)
      reg.adicional += Number(f.monto) || 0;
    }
  }
  const fechas = [...porFecha.keys()].sort();
  return fechas.map(fecha => {
    const reg = porFecha.get(fecha);
    const pequenos = zonas.map(z => reg.porZonaTamano[`${z}|Pequeños`] || 0);
    const grandes = zonas.map(z => reg.porZonaTamano[`${z}|Grandes`] || 0);
    const totalPaquetes = pequenos.reduce((a,b)=>a+b,0) + grandes.reduce((a,b)=>a+b,0);
    return { fecha, pequenos, grandes, totalPaquetes, turbo: reg.turbo, adicional: reg.adicional };
  });
}

export async function generarPdfLiquidacion({ cliente, servicio, fechaInicio, fechaFin, filasResumen, filasDetalle, totalPaquetes, montoAPagar, accion }){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const zonas = agruparFilasResumen(filasResumen || []).filter(g => g.grupo !== "Extras").map(g => g.grupo);

  doc.setFontSize(14); doc.setFont(undefined, "bold");
  doc.text("Mercadopacks S.R.L", 10, 12);
  doc.setFontSize(8); doc.setFont(undefined, "normal");
  doc.text("Av. San Juan Bautista de la Salle 2262, CABA. · Tel. (+54) 9 11 33051991", 10, 17);

  doc.setFontSize(9);
  doc.text(`Fecha Inicio: ${formatearFecha(fechaInicio)}`, 200, 12);
  doc.text(`Fecha Fin: ${formatearFecha(fechaFin)}`, 240, 12);
  doc.setFont(undefined, "bold");
  doc.text(`Cliente: ${tituloTexto(cliente) || ""}`, 200, 18);
  doc.setFont(undefined, "normal");

  doc.setFontSize(11); doc.setFont(undefined, "bold");
  const tipoLabel = servicio === "fulfillment" ? "MENSUAL" : "SEMANAL";
  doc.text(`LIQUIDACION ${tipoLabel} - DETALLE DIARIO`, 148.5, 26, { align: "center" });
  doc.setFont(undefined, "normal");

  const diario = armarDetalleDiarioPdf(filasDetalle || [], zonas);
  const headZonas1 = zonas.map(() => "");
  const headZonas2 = zonas;
  doc.autoTable({
    startY: 30,
    head: [
      ["Fecha", ...zonas.map(()=>"Pequeños"), ...zonas.map(()=>"Grandes"), "Total Paq.", "Turbo", "Adicional ($)"],
      ["", ...zonas, ...zonas, "", "", ""],
    ],
    body: diario.map(d => [
      formatearFecha(d.fecha),
      ...d.pequenos.map(n => n || ""),
      ...d.grandes.map(n => n || ""),
      d.totalPaquetes || "",
      d.turbo || "",
      d.adicional ? formatearMoneda(d.adicional) : "",
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [246, 190, 5], textColor: [17, 17, 17] },
    theme: "grid",
  });

  let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 60) + 10;
  doc.setFontSize(11); doc.setFont(undefined, "bold");
  doc.text("RESUMEN", 148.5, y, { align: "center" });
  doc.setFont(undefined, "normal");
  y += 4;

  const filasResumenPdf = [];
  agruparFilasResumen(filasResumen || []).forEach(g => {
    g.filas.forEach((f, i) => filasResumenPdf.push([i === 0 ? g.grupo : "", f.item, f.cantidad == null ? "-" : f.cantidad, f.precio == null ? "-" : formatearMoneda(f.precio), formatearMoneda(f.monto)]));
  });
  doc.autoTable({
    startY: y,
    head: [["Grupo", "Item", "Total Período", "Precio Unitario", "Monto Total"]],
    body: filasResumenPdf,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [246, 190, 5], textColor: [17, 17, 17] },
    theme: "grid",
  });

  y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 6;
  doc.autoTable({
    startY: y,
    body: [["TOTAL PAQUETES", String(totalPaquetes || 0), "TOTAL A PAGAR", formatearMoneda(montoAPagar || 0)]],
    styles: { fontSize: 10, fontStyle: "bold", cellPadding: 3 },
    bodyStyles: { fillColor: [246, 190, 5], textColor: [17, 17, 17] },
    theme: "grid",
  });

  const nombreArchivo = `Liquidacion ${tituloTexto(cliente) || ""} ${fechaInicio} a ${fechaFin}.pdf`;
  if(accion === "descargar") doc.save(nombreArchivo);
  else window.open(doc.output("bloburl"), "_blank");
}
