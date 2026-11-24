// Seguimiento de Repartidores en ruta.
// Viene de index.html (Etapa 3a de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { tituloNombre } from "../core/formato.js";
import { crearComboGenerico, crearPopoverGenerico } from "../ui/combos.js";
import { fechaART, limiteDiaART, diaSiguienteStr } from "../core/fechas.js";
import { _fmtPct } from "../core/porcentajes.js";

  // Mide el alto real de la fila de títulos de columna y corre la fila de
  // filtros justo debajo (en vez de un top: fijo adivinado) — bug real
  // 2026-11-15: un offset fijo dejaba un hueco de 1-2px por el que se veía
  // el cuerpo de la tabla al scrollear. Se llama de nuevo cada vez que se
  // vuelve a pintar la tabla de ruta (el alto no cambia, pero así queda a
  // prueba de que algún ajuste futuro de fuente/ícono lo corra un poco).
  function ajustarOffsetFilaFiltros(){
    document.querySelectorAll(".tabla-scroll").forEach(wrap=>{
      const filaFiltros = wrap.querySelector(".fila-filtros");
      if(!filaFiltros) return;
      const filaTitulos = filaFiltros.parentElement.querySelector("tr:first-child");
      if(!filaTitulos) return;
      const h = Math.ceil(filaTitulos.getBoundingClientRect().height);
      filaFiltros.querySelectorAll("th").forEach(th => { th.style.top = h + "px"; });
    });
  }
  // Seguimiento de Repartidores — Seguimiento en ruta
  // ======================================================================

  // Mapa localidad -> zona, copiado tal cual de dashboard_logistica.html
  // (criterio ML Flex del equipo) para que la zona de cada chofer se vea
  // igual acá que en producción — la columna "Zona" que trae LightData NO
  // se usa para esto (ver nota en el dashboard viejo).
  function normalizarLocalidad(str){
    return (str || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[,.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const ZONA_POR_LOCALIDAD = {
    'caba':'CABA', 'capital federal':'CABA', 'buenos aires':'CABA', 'caba villa lugano':'CABA', 'palermo soho':'CABA',
    'agronomia':'CABA', 'almagro':'CABA', 'balvanera':'CABA', 'barracas':'CABA', 'belgrano':'CABA',
    'boedo':'CABA', 'caballito':'CABA', 'chacarita':'CABA', 'coghlan':'CABA', 'colegiales':'CABA',
    'constitucion':'CABA', 'flores':'CABA', 'floresta':'CABA', 'la boca':'CABA', 'la paternal':'CABA',
    'paternal':'CABA', 'liniers':'CABA', 'mataderos':'CABA', 'monte castro':'CABA',
    'montserrat':'CABA', 'monserrat':'CABA', 'nueva pompeya':'CABA', 'nunez':'CABA', 'palermo':'CABA',
    'parque avellaneda':'CABA', 'parque chacabuco':'CABA', 'parque chas':'CABA', 'parque patricios':'CABA',
    'puerto madero':'CABA', 'recoleta':'CABA', 'retiro':'CABA', 'saavedra':'CABA',
    'san cristobal':'CABA', 'san nicolas':'CABA', 'san telmo':'CABA', 'velez sarsfield':'CABA',
    'versalles':'CABA', 'versailles':'CABA', 'villa crespo':'CABA', 'villa del parque':'CABA',
    'villa devoto':'CABA', 'villa general mitre':'CABA', 'villa gral mitre':'CABA', 'villa lugano':'CABA',
    'villa luro':'CABA', 'villa ortuzar':'CABA', 'villa pueyrredon':'CABA', 'villa real':'CABA',
    'villa riachuelo':'CABA', 'villa santa rita':'CABA', 'villa soldati':'CABA', 'villa urquiza':'CABA',
    'abasto':'CABA', 'belgrano barrancas':'CABA', 'belgrano r':'CABA',
    'vicente lopez':'Norte', 'olivos':'Norte', 'florida':'Norte', 'florida oeste':'Norte',
    'la lucila':'Norte', 'munro':'Norte', 'carapachay':'Norte', 'villa martelli':'Norte', 'villa adelina':'Norte',
    'san isidro':'Norte', 'acassuso':'Norte', 'martinez':'Norte', 'boulogne':'Norte', 'beccar':'Norte',
    'san fernando':'Norte', 'victoria':'Norte', 'virreyes':'Norte', 'vireeyes':'Norte',
    'tigre':'Norte', 'don torcuato':'Norte', 'general pacheco':'Norte', 'grl pacheco tigre':'Norte',
    'el talar':'Norte', 'benavidez':'Norte',
    'ricardo rojas':'Norte', 'rincon de milberg':'Norte', 'nordelta':'Norte', 'villa nueva':'Norte',
    'dique lujan':'Norte', 'troncos del talar':'Norte', 'los troncos':'Norte', 'los troncos del talar':'Norte',
    'san martin':'Norte', 'general san martin':'Norte', 'gral san martin':'Norte', 'villa ballester':'Norte',
    'san andres':'Norte', 'villa maipu':'Norte', 'villa bosch':'Norte', 'jose leon suarez':'Norte', 'billinghurst':'Norte',
    'villa lynch':'Norte',
    'malvinas argentinas':'Norte', 'los polvorines':'Norte', 'grand bourg':'Norte', 'tortuguitas':'Norte',
    'tierras altas':'Norte', 'villa de mayo':'Norte', 'ingeniero adolfo sourdeaux':'Norte', 'pablo nogues':'Norte',
    'san miguel':'Norte', 'bella vista':'Norte', 'muniz':'Norte', 'campo de mayo':'Norte',
    'escobar':'Norte', 'belen de escobar':'Norte', 'garin':'Norte', 'garin escobar':'Norte',
    'ingeniero maschwitz':'Norte', 'maquinista savio':'Norte', 'matheu':'Norte',
    'pilar':'Norte', 'del viso':'Norte', 'manuel alberti':'Norte', 'villa rosa':'Norte', 'la lonja':'Norte',
    'pilar sur':'Norte', 'presidente derqui':'Norte', 'manzanares':'Norte', 'zelaya':'Norte',
    'pilar el panchito':'Norte', 'fatima':'Norte',
    'jose c paz':'Norte', 'jose clemente paz':'Norte',
    'zarate':'Norte', 'campana':'Norte',
    'avellaneda':'Sur', 'wilde':'Sur', 'sarandi':'Sur', 'gerli':'Sur', 'dock sud':'Sur', 'pineyro':'Sur',
    'villa dominico':'Sur',
    'lanus oeste':'Sur', 'lanus este':'Sur', 'lanus':'Sur', 'remedios de escalada':'Sur', 'valentin alsina':'Sur',
    'monte chingolo':'Sur', 'villa centenario':'Sur',
    'lomas de zamora':'Sur', 'banfield':'Sur', 'temperley':'Sur', 'turdera':'Sur', 'llavallol':'Sur',
    'san jose':'Sur', 'villa fiorito':'Sur', 'ingeniero budge':'Sur',
    'quilmes':'Sur', 'bernal':'Sur', 'don bosco':'Sur', 'ezpeleta':'Sur', 'villa la florida':'Sur',
    'quilmes oeste':'Sur', 'bernal este':'Sur', 'bernal oeste':'Sur', 'ezpeleta este':'Sur', 'ezpeleta oeste':'Sur',
    'almirante brown':'Sur', 'adrogue':'Sur', 'burzaco':'Sur', 'longchamps':'Sur', 'claypole':'Sur',
    'rafael calzada':'Sur', 'jose marmol':'Sur', 'glew':'Sur', 'don orione':'Sur',
    'berazategui':'Sur', 'ranelagh':'Sur', 'villa espana':'Sur', 'platanos':'Sur', 'berazategui platanos':'Sur',
    'hudson':'Sur', 'sourigues':'Sur',
    'esteban echeverria':'Sur', 'monte grande':'Sur', 'luis guillon':'Sur', 'el jaguel':'Sur', 'canning':'Sur',
    'ezeiza':'Sur', 'tristan suarez':'Sur', 'carlos spegazzini':'Sur', 'la union':'Sur',
    'florencio varela':'Sur', 'bosques':'Sur', 'zeballos':'Sur', 'gobernador costa':'Sur', 'villa vatteone':'Sur',
    'berisso':'Sur', 'villa arguello':'Sur', 'villa zula':'Sur',
    'ensenada':'Sur', 'esenada':'Sur', 'el carmen':'Sur', 'punta lara':'Sur',
    'la plata':'Sur', 'tolosa':'Sur', 'ringuelet':'Sur', 'manuel b gonnet':'Sur', 'city bell':'Sur',
    'villa elisa':'Sur', 'los hornos':'Sur', 'san carlos':'Sur', 'melchor romero':'Sur', 'el peligro':'Sur',
    'villa elvira':'Sur', 'lisandro olmos':'Sur', 'arturo segui':'Sur', 'joaquin gorina':'Sur',
    'presidente peron':'Sur', 'guernica':'Sur',
    'san vicente':'Sur', 'alejandro korn':'Sur',
    'canuelas':'Sur', 'maximo paz':'Sur',
    'tres de febrero':'Oeste', 'partido de tres de febrero':'Oeste', 'caseros':'Oeste', 'ciudadela':'Oeste',
    'santos lugares':'Oeste', 'saenz pena':'Oeste', 'martin coronado':'Oeste', 'pablo podesta':'Oeste',
    'el palomar':'Oeste', 'ciudad jardin del palomar':'Oeste', 'loma hermosa':'Oeste',
    'la matanza':'Oeste', 'ramos mejia':'Oeste', 'san justo':'Oeste', 'haedo':'Oeste',
    'lomas del mirador':'Oeste', 'la tablada':'Oeste', 'villa luzuriaga':'Oeste', 'ciudad evita':'Oeste',
    'aldo bonzi':'Oeste', 'tapiales':'Oeste', 'villa madero':'Oeste', 'isidro casanova':'Oeste',
    'rafael castillo':'Oeste', 'gregorio de la ferrere':'Oeste', 'gregorio de laferrere':'Oeste',
    'moron':'Oeste', 'castelar':'Oeste', 'villa sarmiento':'Oeste',
    'hurlingham':'Oeste', 'villa tesei':'Oeste', 'william c morris':'Oeste',
    'ituzaingo':'Oeste', 'villa udaondo':'Oeste',
    'merlo':'Oeste', 'buenos aires merlo':'Oeste', 'san antonio de padua':'Oeste', 'libertad':'Oeste',
    'parque san martin':'Oeste', 'mariano acosta':'Oeste', 'pontevedra':'Oeste',
    'moreno':'Oeste', 'paso del rey':'Oeste', 'trujui':'Oeste', 'francisco alvarez':'Oeste', 'la reja':'Oeste',
    'gonzalez catan':'Oeste', 'virrey del pino':'Oeste', '20 de junio':'Oeste',
    'general rodriguez':'Oeste', 'las malvinas':'Oeste', 'open door':'Oeste', 'opendoor':'Oeste',
    'marcos paz':'Oeste', 'vicente casares':'Oeste',
  };

  function zonaPorLocalidad(localidadCruda){
    return ZONA_POR_LOCALIDAD[normalizarLocalidad(localidadCruda)] || "Sin zona";
  }

  // Zona del chofer = la más frecuente entre sus paquetes del día (puede
  // tener de más de una), ignorando "Sin zona" salvo que NINGUNO sea
  // reconocible — mismo criterio que dashboard_logistica.html.
  function zonaDeChofer(localidades){
    const conteo = {};
    for(const [loc, cant] of Object.entries(localidades || {})){
      const z = zonaPorLocalidad(loc);
      conteo[z] = (conteo[z] || 0) + cant;
    }
    const reconocidas = Object.keys(conteo).filter(z => z !== "Sin zona");
    const candidatas = reconocidas.length ? reconocidas : Object.keys(conteo);
    if(!candidatas.length) return "Sin zona";
    return candidatas.reduce((mejor, z) => conteo[z] > (conteo[mejor] || 0) ? z : mejor, candidatas[0]);
  }

  const UMBRAL_SIN_ACTIVIDAD_MIN = 45;
  const HORA_CIERRE_DIA_MIN = 23 * 60 + 30;

  // Mismas funciones que calcularEstadoRuta()/calcularEstadoRutaChofer()
  // de dashboard_logistica.html — ver ese archivo para la explicación
  // completa de cada umbral.
  function calcularEstadoRuta(minEntreEntregas, minutosSinActividad){
    if(minutosSinActividad !== null && minutosSinActividad > UMBRAL_SIN_ACTIVIDAD_MIN){
      return { color: "rojo", label: "Sin actividad" };
    }
    if(minEntreEntregas === null) return { color: "gris", label: "Sin datos" };
    if(minEntreEntregas <= 5) return { color: "verde", label: "Óptimo" };
    if(minEntreEntregas <= 20) return { color: "azul", label: "A tiempo" };
    return { color: "rojo", label: "Demorado" };
  }

  function calcularEstadoRutaChofer(entregados, pendientes, sinResolver, diaCerrado){
    if(sinResolver === 0){
      return pendientes === 0
        ? { color: "verde", label: "Terminó sin pendientes" }
        : { color: "azul", label: "Terminó con pendientes" };
    }
    if(diaCerrado) return { color: "rojo", label: "Sin terminar" };
    if(entregados === 0) return { color: "gris", label: "Sin iniciar" };
    return { color: "amarillo", label: "En ruta" };
  }

  function nowMinutesART(){
    const ms = Date.now() - 3 * 60 * 60 * 1000;
    const d = new Date(ms);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }

  const stateRuta = { modoFecha: "hoy", fechaElegida: null, zona: "global", search: "", sort: { key: "sinResolver", dir: "desc" }, filas: [], filtrosCol: {} };

  function fechaRutaActual(){
    if(stateRuta.modoFecha === "ayer") return fechaART(-1);
    if(stateRuta.modoFecha === "elegir") return stateRuta.fechaElegida || fechaART(0);
    return fechaART(0);
  }

  document.getElementById("fecha-ruta-input").addEventListener("change", (e)=>{
    stateRuta.fechaElegida = e.target.value;
    cargarRuta();
  });
  document.getElementById("buscar-ruta").addEventListener("input", (e)=>{
    stateRuta.search = e.target.value.toLowerCase();
    renderRuta();
  });

  crearPopoverGenerico("popover-filtros-ruta");

  crearComboGenerico("combo-fecha-ruta", (valor)=>{
    stateRuta.modoFecha = valor;
    const wrap = document.getElementById("fecha-ruta-wrap");
    if(valor === "elegir"){
      wrap.hidden = false;
      const input = document.getElementById("fecha-ruta-input");
      if(!input.value) input.value = fechaART(0);
      stateRuta.fechaElegida = input.value;
    } else {
      wrap.hidden = true;
    }
    cargarRuta();
  });

  crearComboGenerico("combo-zona-superior", (valor)=>{
    stateRuta.zona = valor;
    renderRuta();
  });

  crearComboGenerico("combo-rendimiento", (valor)=>{
    stateRuta.filtrosCol.rendimiento = valor.toLowerCase();
    renderRuta();
  });
  crearComboGenerico("combo-estado", (valor)=>{
    stateRuta.filtrosCol.estado = valor.toLowerCase();
    renderRuta();
  });
  document.querySelectorAll('[data-sort]').forEach(th=>{
    if(!th.closest("#vista-repa-ruta")) return;
    th.addEventListener("click", (e)=>{
      if(e.target.closest(".mini-info")) return; // el ícono de ayuda no ordena
      const key = th.dataset.sort;
      if(stateRuta.sort.key === key) stateRuta.sort.dir = stateRuta.sort.dir === "asc" ? "desc" : "asc";
      else stateRuta.sort = { key, dir: "desc" };
      renderRuta();
    });
  });

  export async function cargarRuta(){
    document.getElementById("ruta-detalle-overlay").hidden = true;
    const fecha = fechaRutaActual();
    const { data, error } = await sb.rpc("choferes_en_ruta", { p_fecha: fecha });
    if(error){
      console.error("Error cargando choferes_en_ruta:", error);
      document.getElementById("tabla-ruta").innerHTML = `<tr><td colspan="7" class="sin-datos">Error cargando los datos.</td></tr>`;
      return;
    }

    const hoy = fechaART(0);
    const esHoy = fecha === hoy;
    const diaCerrado = !esHoy || nowMinutesART() >= HORA_CIERRE_DIA_MIN;
    const ahoraMin = nowMinutesART();

    stateRuta.filas = data.map(c => {
      const zona = zonaDeChofer(c.localidades);
      const minutosSinActividad = (esHoy && !diaCerrado && c.sin_resolver > 0 && c.min_entre_entregas !== null && c.hora_ultima_actividad)
        ? (ahoraMin - minutosDesdeISO(c.hora_ultima_actividad))
        : null;
      const rendimiento = calcularEstadoRuta(c.min_entre_entregas, minutosSinActividad);
      const estado = calcularEstadoRutaChofer(c.entregados, c.pendientes, c.sin_resolver, diaCerrado);
      const velocidad = c.min_entre_entregas ? (60 / c.min_entre_entregas) : null;
      const terminoElRecorrido = c.sin_resolver === 0;
      return {
        cadete: c.cadete, zona,
        asignados: c.asignados, entregados: c.entregados, pendientes: c.pendientes, sinResolver: c.sin_resolver,
        minEntreEntregas: c.min_entre_entregas, minutosSinActividad, velocidad,
        horaPrimeraEntregaTxt: formatHoraART(c.hora_primera_entrega),
        horaFinTxt: terminoElRecorrido ? formatHoraART(c.hora_ultima_actividad) : "—",
        rendimiento, estado,
        progreso: c.asignados ? (c.entregados / c.asignados) * 100 : 0,
      };
    });

    renderRuta();
    requestAnimationFrame(ajustarOffsetFilaFiltros);
  }

  // Convierte un timestamp ISO (con offset) a "minutos desde las 00:00 ART".
  function minutosDesdeISO(iso){
    const ms = new Date(iso).getTime() - 3 * 60 * 60 * 1000;
    const d = new Date(ms);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }

  function formatHoraART(iso){
    if(!iso) return "—";
    return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  }

  function renderRuta(){
    let filas = stateRuta.filas;
    if(stateRuta.zona !== "global") filas = filas.filter(f => f.zona === stateRuta.zona);
    if(stateRuta.search) filas = filas.filter(f => f.cadete.toLowerCase().includes(stateRuta.search));
    const fr = stateRuta.filtrosCol.rendimiento;
    if(fr) filas = filas.filter(f => f.rendimiento.label.toLowerCase().includes(fr));
    const fe = stateRuta.filtrosCol.estado;
    if(fe) filas = filas.filter(f => f.estado.label.toLowerCase().includes(fe));

    const { key, dir } = stateRuta.sort;
    document.querySelectorAll("#vista-repa-ruta th.ordenable").forEach(th=>{
      const flecha = th.querySelector(".flecha");
      if(!flecha) return;
      if(th.dataset.sort === key){
        flecha.textContent = dir === "asc" ? "▲" : "▼";
        flecha.classList.add("activa");
      } else {
        flecha.textContent = "↕";
        flecha.classList.remove("activa");
      }
    });
    const mul = dir === "asc" ? 1 : -1;
    filas = [...filas].sort((a, b) => {
      let va = a[key], vb = b[key];
      if(typeof va === "string") return va.localeCompare(vb) * mul;
      va = va ?? -Infinity; vb = vb ?? -Infinity;
      return (va - vb) * mul;
    });

    renderKpisRuta(filas);
    renderAlertasRuta(filas);

    const tbody = document.getElementById("tabla-ruta");
    if(!filas.length){
      tbody.innerHTML = `<tr><td colspan="7" class="sin-datos">Sin repartidores para este filtro.</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(f => {
      let celdaPendientes;
      if(f.pendientes === 0){
        celdaPendientes = `<span class="sin-datos">Faltan: 0</span>`;
      } else if(f.sinResolver > 0){
        celdaPendientes = `<button type="button" class="btn-pendientes sin-resolver" data-chofer="${f.cadete}">Sin resolver: ${f.sinResolver}</button>`;
      } else {
        celdaPendientes = `<button type="button" class="btn-pendientes gestionado" data-chofer="${f.cadete}">Gestionados: ${f.pendientes}</button>`;
      }
      const tipRendimiento = (f.rendimiento.label === "Sin actividad"
        ? `Sin ningún movimiento hace ${Math.round(f.minutosSinActividad)} min — consultar al repartidor qué pasó.\n\n`
        : "")
        + `Min. entre entregas: ${f.minEntreEntregas === null ? "—" : f.minEntreEntregas.toFixed(1) + " min"}\n`
        + `Hora 1ª entrega: ${f.horaPrimeraEntregaTxt}\n`
        + `Paq./hora: ${f.velocidad === null ? "—" : f.velocidad.toFixed(1)}`;
      return `
      <tr>
        <td>${tituloNombre(f.cadete)}</td>
        <td>${f.zona}</td>
        <td>
          <div class="ruta-progreso-txt">${f.entregados} de ${f.asignados} (${_fmtPct(f.progreso)})</div>
          <div class="repa-meter ${f.estado.color}"><div style="width:${f.progreso.toFixed(0)}%;"></div></div>
        </td>
        <td><span class="badge ${f.rendimiento.color}" tabindex="0" data-tip="${tipRendimiento.replace(/"/g, "&quot;")}">${f.rendimiento.label}</span></td>
        <td><span class="badge ${f.estado.color}">${f.estado.label}</span></td>
        <td>${f.horaFinTxt}</td>
        <td>${celdaPendientes}</td>
      </tr>
    `; }).join("");
  }

  function renderAlertasRuta(filas){
    const demorados = [...filas].filter(f => f.rendimiento.color === "rojo")
      .sort((a, b) => (b.minEntreEntregas ?? -1) - (a.minEntreEntregas ?? -1));
    const cont = document.getElementById("ruta-alertas-lista");
    if(!demorados.length){
      cont.innerHTML = `<p class="sin-datos">Ningún repartidor está demorado ni sin actividad en este filtro.</p>`;
      return;
    }
    cont.innerHTML = demorados.map(f => `
      <div class="ruta-alerta-fila">
        <span><strong>${tituloNombre(f.cadete)}</strong> <span class="texto-muted">(${f.zona})</span></span>
        <span style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span class="texto-muted">${f.entregados}/${f.asignados} entregados · faltan ${f.pendientes}</span>
          <span class="badge ${f.rendimiento.color}">${f.rendimiento.label} · ${f.rendimiento.label === "Sin actividad" ? "hace " + Math.round(f.minutosSinActividad) + " min" : (f.minEntreEntregas === null ? "sin datos" : f.minEntreEntregas.toFixed(1) + " min/entrega")}</span>
        </span>
      </div>
    `).join("");
  }

  // ----- Detalle de pendientes de un chofer (click en el botón de la tabla) -----
  const ESTADOS_PENDIENTE_GESTIONADO = [
    "nadie", "nadie 2da visita", "reprogramado por comprador",
    "rechazado por el comprador", "reprogramado por meli", "cancelado", "no entregado",
  ];
  function esPendienteGestionado(estado){
    return ESTADOS_PENDIENTE_GESTIONADO.includes((estado || "").toLowerCase().trim());
  }

  let detalleRutaItems = [];
  // Protege contra condición de carrera (bug real 2026-11-15): abrir el
  // detalle de un chofer, cerrarlo y abrir el de otro antes de que la
  // primera consulta termine podía hacer que la respuesta VIEJA pisara a
  // la nueva. Cada apertura saca un número; al volver una respuesta, si ya
  // no es la apertura más reciente, se descarta en silencio.
  let detalleRutaRequestId = 0;

  async function abrirDetalleRutaChofer(cadete){
    const miRequestId = ++detalleRutaRequestId;
    document.getElementById("ruta-detalle-nombre").textContent = cadete;
    document.getElementById("ruta-detalle-overlay").hidden = false;
    document.getElementById("buscar-ruta-detalle").value = "";
    detalleRutaItems = [];
    document.getElementById("tabla-ruta-detalle").innerHTML = `<tr><td colspan="7" class="sin-datos">Cargando…</td></tr>`;
    const fecha = fechaRutaActual();
    const { data, error } = await sb.from("envios")
      .select("tracking,cliente,localidad,zona,estado,fecha_estado,origen")
      .gte("fecha_mercadopacks", limiteDiaART(fecha))
      .lt("fecha_mercadopacks", limiteDiaART(diaSiguienteStr(fecha)))
      .eq("cadete", cadete)
      .not("estado", "in", '("Entregado","Entregado 2DA visita","A retirar")');
    if(miRequestId !== detalleRutaRequestId) return; // ya se abrió otro chofer mientras tanto
    if(error){ console.error("Error cargando detalle de pendientes:", error); detalleRutaItems = []; }
    else detalleRutaItems = data || [];
    renderDetalleRutaTabla();
  }

  function renderDetalleRutaTabla(){
    const q = document.getElementById("buscar-ruta-detalle").value.trim().toLowerCase();
    let items = q
      ? detalleRutaItems.filter(it => (it.tracking || "").toLowerCase().includes(q) || (it.cliente || "").toLowerCase().includes(q))
      : detalleRutaItems;
    items = [...items].sort((a, b) => (esPendienteGestionado(a.estado) ? 1 : 0) - (esPendienteGestionado(b.estado) ? 1 : 0));

    const tbody = document.getElementById("tabla-ruta-detalle");
    if(!items.length){
      tbody.innerHTML = `<tr><td colspan="7" class="sin-datos">Sin resultados.</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(it => {
      const gestionado = esPendienteGestionado(it.estado);
      const hora = it.fecha_estado
        ? new Date(it.fecha_estado).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })
        : "—";
      return `
      <tr>
        <td>${it.tracking || "—"}</td>
        <td>${it.cliente || "—"}</td>
        <td>${it.origen || "—"}</td>
        <td>${it.localidad || "—"}</td>
        <td>${it.zona || "—"}</td>
        <td><span class="mini-dot ${gestionado ? "verde" : "rojo"}" style="margin-right:6px;"></span>${it.estado || "—"}</td>
        <td>${hora}</td>
      </tr>`;
    }).join("");
  }

  document.getElementById("tabla-ruta").addEventListener("click", (e)=>{
    const btn = e.target.closest(".btn-pendientes");
    if(btn) abrirDetalleRutaChofer(btn.dataset.chofer);
  });
  document.getElementById("buscar-ruta-detalle").addEventListener("input", renderDetalleRutaTabla);
  document.getElementById("cerrar-ruta-detalle").addEventListener("click", ()=>{
    document.getElementById("ruta-detalle-overlay").hidden = true;
  });
  // Clic en el fondo oscuro (fuera de la tarjeta) también cierra el modal.
  document.getElementById("ruta-detalle-overlay").addEventListener("click", (e)=>{
    if(e.target.id === "ruta-detalle-overlay") document.getElementById("ruta-detalle-overlay").hidden = true;
  });

  function renderKpisRuta(filas){
    const total = filas.length;
    const conRitmo = filas.filter(f => f.rendimiento.color !== "gris");
    const demorados = conRitmo.filter(f => f.rendimiento.color === "rojo").length;
    const pctDentroRitmo = conRitmo.length ? ((conRitmo.length - demorados) / conRitmo.length) * 100 : null;
    const conVelocidad = filas.filter(f => f.minEntreEntregas !== null);
    const velocidadProm = conVelocidad.length
      ? conVelocidad.reduce((s, f) => s + (60 / f.minEntreEntregas), 0) / conVelocidad.length
      : null;
    const pendientesTotal = filas.reduce((s, f) => s + f.pendientes, 0);
    const sinResolverTotal = filas.reduce((s, f) => s + f.sinResolver, 0);

    const tarjetas = [
      { label: "Repartidores en ruta", valor: total,
        info: "Cantidad de repartidores que entran en el filtro de zona y búsqueda actual (no el total de la operación)." },
      { label: "% dentro de ritmo", valor: pctDentroRitmo === null ? "—" : _fmtPct(pctDentroRitmo),
        info: 'Porcentaje con rendimiento "Óptimo" o "A tiempo" (hasta 20 min entre una entrega y la siguiente), sobre los repartidores que ya tienen al menos 2 entregas (el resto todavía no tiene ritmo medible).' },
      { label: "Demorados / sin actividad", valor: demorados,
        info: 'Repartidores en estado "Demorado" (más de 20 min entre entregas) o "Sin actividad" (más de 45 min sin ningún movimiento).' },
      { label: "Velocidad promedio (paq/h)", valor: velocidadProm === null ? "—" : velocidadProm.toFixed(1),
        info: "Paquetes por hora promedio de los repartidores con al menos 2 entregas (60 ÷ minutos entre entregas de cada repartidor)." },
      { label: "Paquetes pendientes", valor: pendientesTotal,
        info: "Suma de paquetes sin entregar de todas las hojas de ruta de este filtro (asignados − entregados)." },
      { label: "Sin resolver", valor: sinResolverTotal,
        info: "Suma de pendientes que todavía no tienen una gestión cerrada — hay que preguntarle al repartidor qué pasó." },
    ];
    document.getElementById("kpis-ruta").innerHTML = tarjetas.map(t => `
      <div class="kpi-ruta">
        <div class="label">${t.label} <span class="mini-info" tabindex="0" role="img" data-tip="${t.info.replace(/"/g, "&quot;")}"><i data-lucide="info"></i></span></div>
        <div class="valor">${t.valor}</div>
      </div>
    `).join("");
    lucide.createIcons();
  }
