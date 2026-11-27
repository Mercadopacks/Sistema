// Vista compartida de Liquidación (tarjetas de resumen + detalle paginado
// + PDF), usada tanto por Liquidación Clientes (admin, con acciones de
// guardar/confirmar) como por Mis Liquidaciones (cliente, 100% lectura).
// Pedido 2026-11-25 (rediseño, 3ra vuelta): sigue al pie de la letra una
// referencia visual que pasó el usuario — 2 tarjetas separadas (encabezado
// + resumen por zonas, y Detalle de envíos aparte), chips de servicio/tipo
// de liquidación, bullet + chip de cantidad en cada tarjeta de zona, aviso
// dinámico de ítems con tarifa $0,00, filtro de Fecha como combo propio
// (NUNCA <select> nativo, regla del proyecto) con las fechas reales del
// período, columna "ID Venta" en el detalle, y zona como badge. Se saca
// el botón de "Vista previa PDF" (pedido explícito, solo queda Descargar).
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

// Cuánto quedó con tarifa $0,00 (paquetes y colectas) — aviso dinámico
// arriba de las tarjetas, igual a la referencia ("16 paquetes... figuran
// con tarifa $0,00") pero sin el desglose Mediano/Grande de esa
// referencia: acá solo existen 2 categorías (Pequeños/Grandes).
function calcularAvisoTarifaCero(filasResumen){
  let paquetes = 0, colectas = 0;
  agruparFilasResumen(filasResumen || []).forEach(g => {
    g.filas.forEach(f => {
      const cant = Number(f.cantidad) || 0;
      const sinPrecio = f.precio == null || Number(f.precio) === 0;
      if(g.grupo === "Extras"){
        if(f.item === "Colectas" && sinPrecio) colectas += cant;
      } else if(sinPrecio && cant > 0){
        paquetes += cant;
      }
    });
  });
  return { paquetes, colectas };
}

function tarjetaZona(grupo, filas){
  const total = filas.reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0);
  const subtotal = filas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
  return `
    <article class="tarjeta-resumen-liquidacion">
      <div class="tarjeta-resumen-header">
        <span class="tarjeta-resumen-titulo"><span class="tarjeta-resumen-bullet"></span>Envíos ${grupo}</span>
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
        <span class="tarjeta-resumen-pie-izq">Subtotal <span class="tarjeta-resumen-pie-chip">${total}</span></span>
        <span>${formatearMoneda(subtotal)}</span>
      </div>
    </article>
  `;
}

// Tarjeta de Extras: Concepto | Cant. | Importe (Turbos/Colectas/
// Adicionales/Descuentos).
function tarjetaExtras(filas){
  const subtotal = filas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
  return `
    <article class="tarjeta-resumen-liquidacion tarjeta-resumen-liquidacion-extras">
      <div class="tarjeta-resumen-header">
        <span class="tarjeta-resumen-titulo"><span class="tarjeta-resumen-bullet tarjeta-resumen-bullet-negro"></span>Extras</span>
        <span class="tarjeta-resumen-total-chico">Servicios</span>
      </div>
      <table class="tabla-tarjeta-resumen tabla-tarjeta-resumen-extras">
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
    </article>
  `;
}

// Pinta la fila de tarjetas (zonas dinámicas en una grilla de 2 columnas +
// Extras aparte a la derecha, ocupando todo el alto — pedido 2026-11-25,
// 4ta vuelta) + el aviso de tarifa $0,00 en el contenedor
// `${prefijo}-tarjetas`/`${prefijo}-aviso-cero`.
export function renderResumenLiquidacion(prefijo, filasResumen){
  const grupos = agruparFilasResumen(filasResumen || []);
  const contTarjetas = document.getElementById(`${prefijo}-tarjetas`);
  if(contTarjetas){
    contTarjetas.innerHTML = grupos.map(g => g.grupo === "Extras" ? tarjetaExtras(g.filas) : tarjetaZona(g.grupo, g.filas)).join("");
  }
  const aviso = document.getElementById(`${prefijo}-aviso-cero`);
  if(aviso){
    const { paquetes, colectas } = calcularAvisoTarifaCero(filasResumen);
    if(paquetes > 0 || colectas > 0){
      const partes = [];
      if(paquetes > 0) partes.push(`${paquetes} paquete${paquetes === 1 ? "" : "s"}`);
      if(colectas > 0) partes.push(`${colectas} colecta${colectas === 1 ? "" : "s"}`);
      aviso.querySelector(".tarjeta-resumen-aviso-texto").textContent = `${partes.join(" y ")} figuran con tarifa $0,00`;
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }
  }
}

// ===================== Detalle: buscador + filtros + paginación (client-side) =====================

const COLUMNAS_DETALLE = ["N°", "Fecha", "Tipo", "Cuenta", "ID Venta", "Dirección", "Localidad", "Zona", "Tamaño", "Importe"];
const BADGES_ZONA = ["negro", "dorado", "gris", "azul", "verde"];

export function crearEstadoDetalle(){
  return {
    filas: [], filtradas: [], pagina: 0, tamanoPagina: 25,
    busqueda: "", fecha: "", zona: "", tamano: "", tipo: "",
    // Pedido 2026-11-27: corrección manual de Cordón/Tamaño por envío,
    // desde Liquidación Clientes (Mis Liquidaciones no setea `onEditar`,
    // así que para esa pantalla esto queda inerte). `conEdicion` decide si
    // existe la columna "Opciones" (se fija una sola vez al montar la
    // vista, ver montarVistaLiquidacion); `soloLectura` decide si el ícono
    // de cada fila está habilitado (una liquidación ya "generada" no se
    // toca — se actualiza en cada apertura de período, ver
    // abrirPantallaLiquidacionCliente en liquidacion-clientes.js).
    conEdicion: false, soloLectura: false, onEditar: null,
  };
}

function aplicarFiltros(estado){
  const b = (estado.busqueda || "").toLowerCase();
  estado.filtradas = estado.filas.filter(f => {
    if(b){
      const texto = `${f.direccion || ""} ${f.localidad || ""} ${f.cuenta || ""} ${f.id_venta || ""}`.toLowerCase();
      if(!texto.includes(b)) return false;
    }
    if(estado.fecha && f.fecha !== estado.fecha) return false;
    if(estado.zona && f.zona !== estado.zona) return false;
    if(estado.tamano && f.tamano !== estado.tamano) return false;
    if(estado.tipo && f.tipo !== estado.tipo) return false;
    return true;
  });
  estado.pagina = 0;
}

// El combo de Tipo también depende de los datos (qué tipos de fila
// aparecen realmente en este período: Envío/Turbo y los tipos de extra
// configurados) — mismo patrón que el combo de Fecha.
function repoblarComboTipo(prefijo, estado){
  const cont = document.getElementById(`${prefijo}-combo-tipo`);
  const tipos = [...new Set(estado.filas.map(f => f.tipo).filter(Boolean))];
  cont.outerHTML = `
    <div class="combo-filtro" id="${prefijo}-combo-tipo">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Tipo: Todos</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        <li data-valor="" aria-selected="true">Todos</li>
        ${tipos.map(t => `<li data-valor="${t}">${t}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico(`${prefijo}-combo-tipo`, (valor)=>{ estado.tipo = valor; aplicarFiltros(estado); renderDetalle(prefijo, estado); });
}

// Devuelve un color consistente (no aleatorio) para el badge de Zona,
// según el orden en que aparece esa zona por primera vez en las filas.
function colorZona(zona, ordenZonas){
  const i = ordenZonas.indexOf(zona);
  return BADGES_ZONA[i >= 0 ? i % BADGES_ZONA.length : 0];
}

function renderDetalle(prefijo, estado){
  const tbody = document.getElementById(`${prefijo}-tabla-detalle`);
  const total = estado.filtradas.length;
  const tam = estado.tamanoPagina;
  const totalPaginas = Math.max(1, Math.ceil(total / tam));
  estado.pagina = Math.min(estado.pagina, totalPaginas - 1);
  const desde = estado.pagina * tam;
  const pagina = estado.filtradas.slice(desde, desde + tam);
  const ordenZonas = [...new Set(estado.filas.map(f => f.zona).filter(Boolean))];
  const colspan = 10 + (estado.conEdicion ? 1 : 0);
  // Solo Envío/Turbo tienen un envío real detrás para corregir -- las
  // filas de Extras (Adicionales/Descuentos/Colectas) no.
  const puedeEditarFila = f => estado.conEdicion && (f.tipo === "Envío" || f.tipo === "Turbo");
  tbody.innerHTML = !pagina.length
    ? `<tr><td colspan="${colspan}" class="sin-datos">${total ? "Sin resultados para el filtro." : "Sin envíos ni extras en este período."}</td></tr>`
    : pagina.map((f, i) => `
        <tr>
          <td>${desde + i + 1}</td>
          <td>${formatearFecha(f.fecha)}</td>
          <td>${f.tipo}</td>
          <td>${f.cuenta || "—"}</td>
          <td>${f.id_venta || "—"}</td>
          <td>${tituloTexto(f.direccion) || "—"}</td>
          <td>${tituloTexto(f.localidad) || "—"}</td>
          <td>${f.zona ? `<span class="badge-zona-detalle ${colorZona(f.zona, ordenZonas)}">${f.zona}</span>` : "—"}</td>
          <td>${f.tamano || "—"}</td>
          <td class="col-num">${formatearMoneda(f.monto)}</td>
          ${estado.conEdicion ? `<td class="col-num">${puedeEditarFila(f) ? `
            <button type="button" class="btn-icono-chico editar" data-id-interno="${f.id_interno || ""}" ${estado.soloLectura ? "disabled" : ""} title="Corregir cordón/tamaño"><i data-lucide="pencil"></i></button>
          ` : ""}</td>` : ""}
        </tr>
      `).join("");
  if(estado.conEdicion && typeof lucide !== "undefined") lucide.createIcons();
  const desdeFila = total ? desde + 1 : 0;
  const hastaFila = Math.min(total, desde + tam);
  document.getElementById(`${prefijo}-detalle-resumen`).textContent =
    total ? `Mostrando ${desdeFila}–${hastaFila} de ${total} registros` : "Sin registros para este filtro.";
  document.getElementById(`${prefijo}-btn-detalle-anterior`).disabled = estado.pagina <= 0;
  document.getElementById(`${prefijo}-btn-detalle-siguiente`).disabled = estado.pagina >= totalPaginas - 1;
  const btnLimpiar = document.getElementById(`${prefijo}-btn-detalle-limpiar`);
  const hayFiltro = !!(estado.busqueda || estado.fecha || estado.zona || estado.tamano || estado.tipo);
  btnLimpiar.hidden = !hayFiltro;

  // Bug real 2026-11-25 (5ta vuelta): el chip de cantidad contaba TODAS
  // las filas del detalle (envíos + turbos + colectas + adicionales +
  // descuentos) y se mostraba como "N envíos" — llevaba a comparar ese
  // número contra "Total envíos" del encabezado (que sí excluye extras) y
  // parecer una inconsistencia. Se saca el chip por completo; el único
  // número que queda acá es el subtotal filtrado, sin ambigüedad.
  const subtotalFiltrado = estado.filtradas.reduce((acc, f) => acc + (Number(f.monto) || 0), 0);
  const elSubtotal = document.getElementById(`${prefijo}-detalle-subtotal-filtrado`);
  if(elSubtotal) elSubtotal.textContent = formatearMoneda(subtotalFiltrado);
}

// El combo de Fecha depende de los datos (las fechas reales del período
// cargado) — a diferencia de Zona/Tamaño, no se puede armar una sola vez
// al montar la vista. Se reconstruye entero (mismo patrón que el combo de
// período de Liquidación Clientes) cada vez que cambian las filas.
function repoblarComboFecha(prefijo, estado){
  const cont = document.getElementById(`${prefijo}-combo-fecha`);
  const fechas = [...new Set(estado.filas.map(f => f.fecha).filter(Boolean))].sort();
  cont.outerHTML = `
    <div class="combo-filtro" id="${prefijo}-combo-fecha">
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Fecha: Todas</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        <li data-valor="" aria-selected="true">Todas</li>
        ${fechas.map(f => `<li data-valor="${f}">${formatearFecha(f)}</li>`).join("")}
      </ul>
    </div>
  `;
  crearComboGenerico(`${prefijo}-combo-fecha`, (valor)=>{ estado.fecha = valor; aplicarFiltros(estado); renderDetalle(prefijo, estado); });
}

// Carga filas nuevas (al cambiar de período/cliente) — resetea filtros y
// paginación.
export function cargarFilasDetalle(prefijo, estado, filas){
  estado.filas = filas || [];
  estado.busqueda = ""; estado.fecha = ""; estado.zona = ""; estado.tamano = ""; estado.tipo = "";
  const buscador = document.getElementById(`${prefijo}-detalle-buscar`);
  if(buscador) buscador.value = "";
  repoblarComboFecha(prefijo, estado);
  repoblarComboTipo(prefijo, estado);
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
  // Delegado una sola vez acá (no en renderDetalle, que se llama en cada
  // filtro/página) -- igual criterio que el resto de los listeners de esta
  // función. `estado.onEditar` lo setea liquidacion-clientes.js; en Mis
  // Liquidaciones queda null y el click simplemente no hace nada (tampoco
  // debería haber botones ahí, conEdicion queda false).
  document.getElementById(`${prefijo}-tabla-detalle`).addEventListener("click", (e)=>{
    const btn = e.target.closest(".btn-icono-chico.editar");
    if(!btn || btn.disabled || !estado.onEditar) return;
    const idInterno = btn.dataset.idInterno;
    const fila = estado.filas.find(f => f.id_interno === idInterno);
    if(fila) estado.onEditar(fila);
  });
}

// ===================== Esqueleto de la pantalla =====================
// Pedido 2026-11-25 (3ra vuelta): 2 tarjetas SEPARADAS (antes, todo vivía
// en un único .card) — encabezado + resumen por un lado, Detalle de
// envíos por el otro, igual a la referencia.

// `opciones.conAcciones` agrega el footer de Guardar borrador/Confirmar
// liquidación (Liquidación Clientes admin); Mis Liquidaciones no lo pasa.
export function montarVistaLiquidacion(contenedorId, prefijo, opciones){
  opciones = opciones || {};
  const cont = document.getElementById(contenedorId);
  cont.innerHTML = `
    <div class="card">
      <div class="liquidacion-header-unificado">
        <div class="liquidacion-header-datos">
          <div class="liquidacion-header-titulo-fila">
            <h2 id="${prefijo}-nombre"></h2>
            <span class="liq-chip liq-chip-gris" id="${prefijo}-chip-servicio"></span>
            <span class="liq-chip liq-chip-dorado" id="${prefijo}-chip-tipo"></span>
            <span id="${prefijo}-estado"></span>
          </div>
          <div class="liquidacion-header-fechas">
            <i data-lucide="calendar"></i>
            <span>Fecha inicio: <strong id="${prefijo}-fecha-inicio"></strong></span>
            <span class="liquidacion-header-fechas-sep">|</span>
            <span>Fecha fin: <strong id="${prefijo}-fecha-fin"></strong></span>
          </div>
        </div>
        <div class="liquidacion-header-resumen">
          <div class="liquidacion-header-resumen-total">
            <div class="liquidacion-header-resumen-dato">
              <span class="liquidacion-header-resumen-dato-icono"><i data-lucide="package"></i></span>
              <span class="liquidacion-header-resumen-dato-texto">
                <span class="liquidacion-header-resumen-label">Total envíos</span>
                <span class="liquidacion-header-resumen-valor" id="${prefijo}-total-paquetes">—</span>
              </span>
            </div>
            <div class="liquidacion-header-resumen-dato liquidacion-header-resumen-destacado">
              <span class="liquidacion-header-resumen-dato-icono"><i data-lucide="circle-dollar-sign"></i></span>
              <span class="liquidacion-header-resumen-dato-texto">
                <span class="liquidacion-header-resumen-label">Monto total a pagar</span>
                <span class="liquidacion-header-resumen-valor" id="${prefijo}-monto-a-pagar">—</span>
              </span>
            </div>
          </div>
          <button type="button" class="btn-icono btn-icono-dorado" id="${prefijo}-btn-pdf-descargar" data-tip="Descargar PDF"><i data-lucide="download"></i></button>
        </div>
      </div>
    </div>

    <div class="card">
      <div id="${prefijo}-combos-extra" class="buscar-mas-filtrar" style="margin-bottom:10px;"></div>

      <div class="liq-resumen-section-header">
        <span class="liq-resumen-section-titulo">Resumen por zonas y extras</span>
        <span class="tarjeta-resumen-aviso" id="${prefijo}-aviso-cero" hidden>
          <i data-lucide="info"></i><span class="tarjeta-resumen-aviso-texto"></span>
        </span>
      </div>
      <div class="tarjetas-resumen-liquidacion-wrap">
        <div class="tarjetas-resumen-liquidacion-fila" id="${prefijo}-tarjetas"></div>
      </div>

      ${opciones.conAcciones ? `
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
          <button type="button" class="btn-secundario-modal" id="${prefijo}-btn-guardar-borrador" hidden>Guardar borrador</button>
          <button type="button" class="btn-primario" id="${prefijo}-btn-confirmar" hidden>Confirmar liquidación</button>
        </div>
      ` : ""}
    </div>

    <div class="card">
      <div class="liq-detalle-header">
        <span class="liq-detalle-titulo">Detalle de liquidación</span>
        <div class="liq-detalle-subtotal-filtrado">Subtotal filtrado: <strong id="${prefijo}-detalle-subtotal-filtrado"></strong></div>
      </div>
      <div class="buscar-mas-filtrar" style="margin-bottom:10px;">
        <input id="${prefijo}-detalle-buscar" class="buscador" placeholder="Buscar por dirección, localidad o N°…" />
        <div class="combo-filtro" id="${prefijo}-combo-fecha">
          <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Fecha: Todas</button>
          <ul class="combo-filtro-lista" role="listbox" hidden><li data-valor="" aria-selected="true">Todas</li></ul>
        </div>
        <div class="combo-filtro" id="${prefijo}-combo-tipo">
          <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Tipo: Todos</button>
          <ul class="combo-filtro-lista" role="listbox" hidden><li data-valor="" aria-selected="true">Todos</li></ul>
        </div>
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
          <thead><tr>${COLUMNAS_DETALLE.map((c, i) => `<th${i === 0 || i === COLUMNAS_DETALLE.length - 1 ? ' class="col-num"' : ""}>${c}</th>`).join("")}${opciones.conAcciones ? '<th class="col-num">Opciones</th>' : ""}</tr></thead>
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
    </div>
  `;
  const estadoDetalle = crearEstadoDetalle();
  estadoDetalle.conEdicion = !!opciones.conAcciones;
  vincularDetalle(prefijo, estadoDetalle, opciones.zonas);
  lucide.createIcons();
  return estadoDetalle;
}

// ===================== PDF =====================

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
  // "Pequeños"/"Grandes" van con colSpan/rowSpan reales (igual que el
  // PDF de referencia: "PEQUEÑOS" ocupa una sola celda ancha arriba de
  // sus zonas, no se repite por cada una).
  doc.autoTable({
    startY: 30,
    head: [
      [
        { content: "Fecha", rowSpan: 2 },
        { content: "Pequeños", colSpan: zonas.length, styles: { halign: "center" } },
        { content: "Grandes", colSpan: zonas.length, styles: { halign: "center" } },
        { content: "Total Paq.", rowSpan: 2 },
        { content: "Turbo", rowSpan: 2 },
        { content: "Adicional ($)", rowSpan: 2 },
      ],
      [...zonas, ...zonas],
    ],
    body: diario.map(d => [
      formatearFecha(d.fecha),
      ...d.pequenos.map(n => n || ""),
      ...d.grandes.map(n => n || ""),
      d.totalPaquetes || "",
      d.turbo || "",
      d.adicional ? formatearMoneda(d.adicional) : "",
    ]),
    styles: { fontSize: 7, cellPadding: 1.5, halign: "center" },
    columnStyles: { 0: { halign: "left" } },
    headStyles: { fillColor: [246, 190, 5], textColor: [17, 17, 17], halign: "center" },
    theme: "grid",
  });

  let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 60) + 10;
  doc.setFontSize(11); doc.setFont(undefined, "bold");
  doc.text("RESUMEN", 148.5, y, { align: "center" });
  doc.setFont(undefined, "normal");
  y += 4;

  // "Grupo" combinado con rowSpan real (no texto vacío repetido) — una
  // sola celda alta por grupo, igual que el PDF de referencia.
  const filasResumenPdf = [];
  agruparFilasResumen(filasResumen || []).forEach(g => {
    g.filas.forEach((f, i) => {
      const fila = [f.item, f.cantidad == null ? "-" : f.cantidad, f.precio == null ? "-" : formatearMoneda(f.precio), formatearMoneda(f.monto)];
      if(i === 0) fila.unshift({ content: g.grupo, rowSpan: g.filas.length, styles: { valign: "middle", fontStyle: "bold" } });
      filasResumenPdf.push(fila);
    });
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
