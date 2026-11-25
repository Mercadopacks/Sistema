// Fallidos y Cambios (operativo): reemplaza la planilla "Seguimiento Fallidos
// y Devoluciones V2".
// Viene de index.html (Etapa 3b de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { formatearFechaHora, tituloTexto, tituloNombre } from "../core/formato.js";
import { mostrarAviso } from "../ui/dialogos.js";
import { crearComboGenerico, crearPopoverGenerico } from "../ui/combos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";
import { fechaART, fechaArtDeIso } from "../core/fechas.js";

  // ======================================================================
  // Fallidos y Cambios — reemplaza la planilla "Seguimiento Fallidos y
  // Devoluciones V2" (ver Sistema_Cambios_Fallidos_Mercadopacks.md).
  // Un paquete fallido/cambio que nadie tocó todavía NO tiene fila en
  // `fallidos_seguimiento` — se calcula al vuelo cruzando `envios`
  // (filtrado por el mapeo de `parametros_fallidos_mapeo`) con esa tabla.
  // Antigüedad = hoy − fecha_mercadopacks (confirmado con el usuario:
  // fecha_estado se mueve con cada cambio de estado y no sirve para medir
  // cuánto tiempo lleva un paquete sin entregar).
  // ======================================================================

  const ESTATUS_LABEL_FALLIDOS = {
    pendiente: "Pendiente",
    devuelto_tienda: "Devuelto a tienda",
    recibido_planta: "Recibido en planta",
    descontar: "Descontar al repartidor",
    cerrado_manual: "Cerrado",
  };

  export const stateFallidos = {
    // modo "repartidor" (default, pedido 2026-11-16): pantalla principal
    // con un repartidor por fila y, al clickear uno, el detalle de sus
    // casos pendientes ordenados por antigüedad. modo "todos": el listado
    // plano de siempre, con los chips Fallido/Cambio para filtrar.
    modo: "repartidor", choferSeleccionado: null, choferSeleccionadoNombre: null, searchRepartidor: "", tipoRepartidor: "todos",
    sortChofer: { key: "diasMax", dir: "desc" },
    tipo: "todos", destino: "", estatus: "pendiente", rangoDias: 30, search: "",
    mapeo: {}, umbrales: { pedir: 2, prioridad: 3, revisar: 5 }, filas: [],
    nombresPorLightdataId: {}, // lightdata_id -> nombre (choferes_roster), ver cargarNombresPorLightdataId()
    lightdataIdPorNombre: {}, // nombre normalizado -> lightdata_id (mapa inverso, mismo origen)
    seleccionados: new Set(), // claves "id_interno::id_seguimiento" para cerrar masivamente (pedido 2026-11-19)
  };

  // Lightdata a veces carga el nombre del repartidor con espacios de más
  // (ej. "Fiorella  Souza", doble espacio entre nombre y apellido) —
  // distinto al nombre cargado a mano en el roster/Asistencia. Sin esto,
  // una comparación exacta de texto nunca matchea y el repartidor queda
  // "sin fallidos" aunque sí tenga (bug real 2026-11-18, caso Fiorella
  // Souza). Se usa en TODO cruce entre envios.cadete y
  // choferes_roster/asistencia_diaria.nombre — trim + colapsar espacios,
  // sin tocar mayúsculas/acentos (acá solo es para que matchee, no para
  // mostrarlo).
  export function normEspaciosNombre(s){
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // Como normEspaciosNombre, pero además saca acentos y pasa a minúscula —
  // para cruzar nombres contra el roster cuando chofer_lightdata_id no
  // está disponible (ver claveRepartidorEnvio). Sin esto, diferencias de
  // acentuación entre el Excel de Lightdata y el roster (no diferencias de
  // ortografía real, como "Gonzales" vs "Gonzalez" — eso no se puede
  // resolver acá, es un dato mal cargado) hacen fallar el cruce.
  function normalizarParaMatch(s){
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }

  // Cruzar repartidores por ID de Lightdata, no por nombre (pedido
  // 2026-11-18, ver lightdata_api_envios.md): `envios.chofer_lightdata_id`
  // se completa con `didcadete` (scripts/vincular_choferes_envios.py), el
  // mismo ID que `lightdata_usuarios.lightdata_id` / `choferes_roster.
  // lightdata_id` / `asistencia_diaria.lightdata_id`. Si todavía no está
  // completado (envíos/asistencias de antes de este cambio, o que el
  // vinculador aún no procesó), cae al nombre normalizado como respaldo —
  // nunca rompe, solo deja de ser 100% confiable para esos casos viejos.
  export function claveRepartidorEnvio(envio){
    if(envio.chofer_lightdata_id != null) return `ld:${envio.chofer_lightdata_id}`;
    // Sin ID todavía (envío viejo que el vinculador no tocó) — antes de
    // caer al nombre crudo como clave (que separa en un grupo aparte a un
    // repartidor que en otras filas SÍ tiene ID, ej. bug real 2026-11-19
    // "Cristian Casenave" apareciendo duplicado en "Por repartidor"), se
    // intenta resolver el ID por nombre normalizado contra el roster.
    const idPorNombre = stateFallidos.lightdataIdPorNombre[normalizarParaMatch(envio.cadete)];
    if(idPorNombre != null) return `ld:${idPorNombre}`;
    return `nombre:${normEspaciosNombre(envio.cadete) || "Sin repartidor"}`;
  }
  export function claveRepartidorAsistencia(f){
    return f.lightdata_id != null
      ? `ld:${f.lightdata_id}`
      : `nombre:${normEspaciosNombre(f.nombre)}`;
  }

  function diasDesde(fechaISO){
    if(!fechaISO) return null;
    const hoy = new Date(fechaART(0) + "T00:00:00Z");
    // fecha_mercadopacks ahora es timestamptz (ver migración
    // 2026-11-23_fecha_mercadopacks_con_hora.sql) — hay que convertir al
    // "día ART" antes de comparar, porque un horario de la noche (ej.
    // 23:50 ART) cae en el día SIGUIENTE en UTC.
    const d = new Date(fechaArtDeIso(fechaISO) + "T00:00:00Z");
    return Math.round((hoy - d) / (24 * 60 * 60 * 1000));
  }

  // `origen` (Directo/ML/TNube/ML TURBO, ver diccionario_de_datos.md) ya es
  // columna propia de `envios` (ver reglas_de_negocio.md, rediseño sin `raw`).
  // `envios_contacto_destinatario(direccion)` es un embed por FK (ver
  // migración 2026-11-19h) — PostgREST lo resuelve solo porque
  // envios_contacto_destinatario.id_interno referencia a envios.id_interno.
  // Sin la policy de esa migración esto devuelve [] en vez de la fila (RLS
  // silenciosa, no error) para cualquiera sin la vista "fallidos".
  const COLUMNAS_ENVIO_FALLIDOS = "id_interno,tracking,cliente,localidad,cadete,chofer_lightdata_id,estado,fecha_mercadopacks,logistica_inversa,logistica_inversa_real,observaciones,origen,envios_contacto_destinatario(direccion)";

  // El Estado de Lightdata NO define un Cambio (describe el paquete NUEVO
  // que se entrega, no si el chofer ya devolvió el producto ORIGINAL) — la
  // señal real está en Logistica Inversa/Observaciones, texto libre sin
  // estandarizar (confirmado con el usuario 2026-11-16). Por eso un Cambio
  // puede entrar a la lista aunque su Estado no sea ninguno de los mapeados
  // (ej. "Entregado" del paquete nuevo, con el original todavía sin volver).
  // Logistica Inversa es texto libre sin estandarizar (ver
  // diccionario_de_datos.md) — además de vacío/null, puede traer
  // literalmente "No"/"NO"/"no" (107 casos reales confirmados 2026-11-19),
  // que significa "no hay logística inversa", no lo contrario. Respaldo
  // SOLO para envíos que todavía no tienen `logistica_inversa_real`
  // calculado (ver abajo) — no usar como fuente principal.
  export function tieneLogisticaInversaReal(valor){
    const v = (valor || "").trim().toLowerCase();
    return v !== "" && v !== "no" && v !== "n/a" && v !== "na";
  }

  // `envio.logistica_inversa_real` (booleano, completado por
  // vincular_choferes_envios.py contra el filtro real de Lightdata —
  // 0=No/1=Sí/2=Todos, confirmado confiable 2026-11-19, ver
  // lightdata_api_envios.md) es la fuente de verdad. Null = todavía no se
  // procesó ese envío con el fix nuevo (histórico o recién publicado) —
  // ahí cae al texto libre como mejor esfuerzo, ya corregido para no
  // contar "No" como señal.
  function determinarTipoDestinoFallido(envio){
    const esCambio = envio.logistica_inversa_real === true
      || (envio.logistica_inversa_real == null && tieneLogisticaInversaReal(envio.logistica_inversa))
      || /cambio/i.test(envio.observaciones || "");
    if(esCambio) return { tipo: "Cambio", destino: "Devolver a tienda" };
    return stateFallidos.mapeo[envio.estado] || null;
  }

  function alertaDiasFallido(dias){
    const u = stateFallidos.umbrales;
    if(dias === null) return { label: "—", color: "gris" };
    if(dias >= u.revisar) return { label: "Revisar", color: "rojo" };
    if(dias >= u.prioridad) return { label: "Prioridad", color: "naranja" };
    if(dias >= u.pedir) return { label: "Pedir", color: "amarillo" };
    return { label: "Normal", color: "verde" };
  }

  async function cargarMapeoFallidos(){
    const { data, error } = await sb.from("parametros_fallidos_mapeo").select("estado,tipo,destino");
    if(error){ console.error("Error cargando parametros_fallidos_mapeo:", error); stateFallidos.mapeo = {}; return; }
    stateFallidos.mapeo = {};
    (data || []).forEach(m => { stateFallidos.mapeo[m.estado] = { tipo: m.tipo, destino: m.destino }; });
  }

  async function cargarUmbralesFallidos(){
    const { data, error } = await sb.from("parametros_alertas_fallidos").select("clave,valor_dias");
    if(error){ console.error("Error cargando parametros_alertas_fallidos:", error); return; }
    (data || []).forEach(u => { if(u.clave in stateFallidos.umbrales) stateFallidos.umbrales[u.clave] = u.valor_dias; });
  }

  // Bug real 2026-11-19: `envios.chofer_lightdata_id` se completa en vivo
  // por ID (vincular_choferes_envios.py), pero `envios.cadete` (texto,
  // viene del Excel) puede quedar vacío para esos mismos envíos — "Por
  // repartidor" agrupaba bien por ID (clave `ld:<id>`) pero mostraba
  // "Sin repartidor" para todos, así que varios repartidores DISTINTOS se
  // veían como filas idénticas repetidas en vez de agruparse ni
  // distinguirse. Se resuelve el nombre real por `chofer_lightdata_id`
  // contra el roster como respaldo cuando `cadete` viene vacío.
  export async function cargarNombresPorLightdataId(){
    const { data, error } = await sb.from("choferes_roster").select("nombre,lightdata_id").not("lightdata_id", "is", null);
    if(error){ console.error("Error cargando choferes_roster (nombres por lightdata_id):", error); return; }
    stateFallidos.nombresPorLightdataId = {};
    stateFallidos.lightdataIdPorNombre = {};
    (data || []).forEach(c => {
      stateFallidos.nombresPorLightdataId[c.lightdata_id] = c.nombre;
      stateFallidos.lightdataIdPorNombre[normalizarParaMatch(c.nombre)] = c.lightdata_id;
    });
  }

  // El ID de Lightdata manda sobre el texto de `cadete` (mismo criterio que
  // claveRepartidorEnvio/lightdata_api_envios.md): si hay chofer_lightdata_id,
  // se muestra el nombre del roster para ESE id, aunque el texto de `cadete`
  // diga otra cosa — bug real 2026-11-19: un envío con cadete="Nahuel
  // Gonzalez" pero chofer_lightdata_id=198 era en realidad de Ian Velez (el
  // texto había quedado desactualizado tras una reasignación en Lightdata).
  // Mostrar el texto crudo primero ocultaba ese tipo de error.
  export function nombreRepartidorFallido(envio){
    if(envio.chofer_lightdata_id != null){
      const porId = stateFallidos.nombresPorLightdataId[envio.chofer_lightdata_id];
      if(porId) return porId;
    }
    const nombreCadete = normEspaciosNombre(envio.cadete);
    if(nombreCadete) return nombreCadete;
    return "Sin repartidor";
  }

  export async function cargarFallidos(){
    stateFallidos.seleccionados.clear(); // datos frescos: las filas viejas ya no son válidas
    await Promise.all([cargarMapeoFallidos(), cargarUmbralesFallidos(), cargarNombresPorLightdataId()]);
    const estados = Object.keys(stateFallidos.mapeo);
    if(!estados.length){
      stateFallidos.filas = [];
      renderFallidos();
      return;
    }
    const cutoff = stateFallidos.rangoDias ? fechaART(-stateFallidos.rangoDias) : null;

    // Query A: candidatos por Estado (fallidos clásicos).
    let qA = sb.from("envios").select(COLUMNAS_ENVIO_FALLIDOS).in("estado", estados);
    if(cutoff) qA = qA.gte("fecha_mercadopacks", cutoff);

    // Query D: candidatos por señal de Cambio (Logistica Inversa /
    // Observaciones), independiente del Estado — ver determinarTipoDestinoFallido().
    // "not.is.null" solo no alcanza: Logistica Inversa trae literalmente
    // "No"/"NO"/"no" en varios envíos (texto libre sin estandarizar), que
    // significa que NO hay logística inversa — se excluyen acá para no
    // traerlos como candidatos (la clasificación real/definitiva igual
    // pasa por tieneLogisticaInversaReal() más abajo, esto es solo para
    // no pedir de más).
    let qD = sb.from("envios").select(COLUMNAS_ENVIO_FALLIDOS)
      .or("logistica_inversa_real.eq.true,and(logistica_inversa.not.is.null,logistica_inversa.not.ilike.no),observaciones.ilike.%cambio%");
    if(cutoff) qD = qD.gte("fecha_mercadopacks", cutoff);

    let qB = sb.from("fallidos_seguimiento").select("*");
    if(cutoff) qB = qB.gte("created_at", cutoff + "T00:00:00Z");

    // Las 3 son independientes entre sí — antes se esperaban una por una
    // (la suma de sus tiempos), ahora corren en paralelo (el tiempo total
    // pasa a ser el de la más lenta). Ver reglas_de_negocio.md, changelog
    // 2026-11-18, para la medición real que mostró esto.
    const [
      { data: enviosA, error: errA },
      { data: enviosD, error: errD },
      { data: seguimiento, error: errB },
    ] = await Promise.all([qA, qD, qB]);

    if(errA){ console.error("Error cargando envíos fallidos:", errA); stateFallidos.filas = []; renderFallidos(); return; }
    if(errD) console.error("Error cargando envíos con señal de cambio:", errD);
    if(errB){ console.error("Error cargando fallidos_seguimiento:", errB); }
    const seguimientoRows = seguimiento || [];

    const enviosById = {};
    (enviosA || []).forEach(e => { enviosById[e.id_interno] = e; });
    (enviosD || []).forEach(e => { enviosById[e.id_interno] = e; });

    // Casos cerrados cuyo envío ya no aparece en A ni en D (ej. "descontar"
    // sobre un paquete que Lightdata después marcó de otra forma) — se
    // busca su dato de envío aparte porque ninguna de las dos lo trae.
    const idsFaltantes = [...new Set(seguimientoRows.map(s => s.id_interno))].filter(id => !enviosById[id]);
    if(idsFaltantes.length){
      const { data: enviosC } = await sb.from("envios")
        .select(COLUMNAS_ENVIO_FALLIDOS)
        .in("id_interno", idsFaltantes);
      (enviosC || []).forEach(e => { enviosById[e.id_interno] = e; });
    }

    const seguimientoPorEnvio = {};
    seguimientoRows.forEach(s => {
      (seguimientoPorEnvio[s.id_interno] = seguimientoPorEnvio[s.id_interno] || []).push(s);
    });

    const filas = [];
    Object.values(enviosById).forEach(envio => {
      const grupo = seguimientoPorEnvio[envio.id_interno] || [];
      // "A retirar" nunca es un fallido/cambio (el paquete está esperando
      // que el cliente lo retire, no hubo intento fallido), y "Devuelto al
      // cliente" significa que el caso ya se gestionó (pedido del usuario
      // 2026-11-20) — ambos se excluyen acá sin importar cómo esté
      // configurado parametros_fallidos_mapeo ni la señal de logística
      // inversa (qD), salvo que ya tengan un caso abierto a mano
      // (grupo.length), que se respeta.
      const ESTADOS_SIEMPRE_EXCLUIDOS = ["A retirar", "Devuelto al cliente"];
      const clasif = (ESTADOS_SIEMPRE_EXCLUIDOS.includes(envio.estado) && !grupo.length) ? null : determinarTipoDestinoFallido(envio);
      if(!clasif && !grupo.length) return; // sin señal de fallido/cambio y nadie lo tocó a mano: no entra
      const tipo = clasif ? clasif.tipo : "—";
      const destino = clasif ? clasif.destino : "—";
      const original = grupo.find(s => !s.duplicado) || null;
      const duplicados = grupo.filter(s => s.duplicado);
      const base = (seg, duplicado) => ({
        envio, tipo, destino, duplicado,
        seguimiento: seg,
        estatus: seg ? seg.estatus : "pendiente",
        dias: diasDesde(envio.fecha_mercadopacks),
      });
      filas.push(base(original, false));
      duplicados.forEach(s => filas.push(base(s, true)));
    });
    stateFallidos.filas = filas;
    renderFallidos();
  }

  function renderKpisFallidos(filas){
    const u = stateFallidos.umbrales;
    const pendientes = filas.filter(f => f.estatus === "pendiente");
    const urgentes = pendientes.filter(f => f.dias !== null && f.dias >= u.prioridad);
    const cerrados = filas.filter(f => f.estatus !== "pendiente");
    const tarjetas = [
      { label: "Pendientes", valor: pendientes.length },
      { label: "Urgentes (Prioridad + Revisar)", valor: urgentes.length },
      { label: "Cerrados en este rango", valor: cerrados.length },
    ];
    document.getElementById("mini-kpis-fallidos").innerHTML = tarjetas.map(t => `
      <div class="kpi-ruta"><div class="label">${t.label}</div><div class="valor">${t.valor}</div></div>
    `).join("");
  }

  // Resumen por repartidor para el modo "Por repartidor" — solo casos
  // pendientes (un repartidor ya no tiene nada "para rendir" una vez
  // cerrado el caso), agrupados por chofer, ordenados por el caso más
  // antiguo de cada uno (el repartidor con el caso más urgente va primero).
  function renderFallidosPorChofer(){
    const pendientes = stateFallidos.filas.filter(f => f.estatus === "pendiente");
    const porChofer = {};
    pendientes.forEach(f => {
      const clave = claveRepartidorEnvio(f.envio);
      const nombre = nombreRepartidorFallido(f.envio);
      const g = porChofer[clave] || (porChofer[clave] = { clave, nombre, fallidos: 0, cambios: 0, diasMax: 0 });
      if(f.tipo === "Cambio") g.cambios++; else g.fallidos++;
      if(f.dias !== null && f.dias > g.diasMax) g.diasMax = f.dias;
    });
    let grupos = Object.values(porChofer).map(g => ({ ...g, total: g.fallidos + g.cambios }));

    if(stateFallidos.tipoRepartidor === "Fallido") grupos = grupos.filter(g => g.fallidos > 0);
    else if(stateFallidos.tipoRepartidor === "Cambio") grupos = grupos.filter(g => g.cambios > 0);

    const q = stateFallidos.searchRepartidor;
    if(q) grupos = grupos.filter(g => g.nombre.toLowerCase().includes(q));

    const { key, dir } = stateFallidos.sortChofer;
    document.querySelectorAll("#fallidos-chofer-lista-card th.ordenable").forEach(th=>{
      const flecha = th.querySelector(".flecha");
      if(th.dataset.sort === key){ flecha.textContent = dir === "asc" ? "▲" : "▼"; flecha.classList.add("activa"); }
      else { flecha.textContent = "↕"; flecha.classList.remove("activa"); }
    });
    const mul = dir === "asc" ? 1 : -1;
    grupos.sort((a, b) => {
      const va = a[key], vb = b[key];
      if(typeof va === "string") return va.localeCompare(vb) * mul;
      return (va - vb) * mul;
    });

    const tbody = document.getElementById("tabla-fallidos-por-chofer");
    if(!grupos.length){
      tbody.innerHTML = `<tr><td colspan="5" class="sin-datos">Sin casos pendientes.</td></tr>`;
      return;
    }
    tbody.innerHTML = grupos.map(g => {
      const alerta = alertaDiasFallido(g.diasMax);
      return `
      <tr class="fila-clicable" data-chofer="${g.clave.replace(/"/g, "&quot;")}" data-chofer-nombre="${g.nombre.replace(/"/g, "&quot;")}">
        <td>${tituloNombre(g.nombre)}</td>
        <td>${g.fallidos}</td>
        <td>${g.cambios}</td>
        <td>${g.total}</td>
        <td><span class="badge ${alerta.color}">${g.diasMax} d · ${alerta.label}</span></td>
      </tr>`;
    }).join("");
  }

  // Muestra/oculta las tarjetas según el modo actual y si hay un
  // repartidor seleccionado — ver stateFallidos.modo/choferSeleccionado.
  // El detalle por repartidor es un MODAL aparte (pedido 2026-11-18: antes
  // reusaba la misma tarjeta/tabla que "Todos", cambiando de pantalla y
  // mezclando el estado de los filtros de una vista con la otra). Ahora
  // "Por repartidor"/"Todos" son las dos únicas pantallas de esta vista;
  // el detalle de un repartidor se abre arriba de la que esté activa, sin
  // tocarla, y al cerrarlo se vuelve exactamente a donde se estaba.
  function aplicarModoFallidos(){
    const enRepartidor = stateFallidos.modo === "repartidor";
    const detalle = enRepartidor && !!stateFallidos.choferSeleccionado;
    document.getElementById("fallidos-chofer-lista-card").hidden = !enRepartidor;
    document.getElementById("fallidos-card-principal").hidden = enRepartidor;
    const yaEstabaAbierto = !document.getElementById("modal-detalle-fallidos").hidden;
    document.getElementById("modal-detalle-fallidos").hidden = !detalle;
    if(detalle){
      document.getElementById("modal-fallidos-titulo").textContent = stateFallidos.choferSeleccionadoNombre || stateFallidos.choferSeleccionado;
      // Si se acaba de ABRIR (no estaba abierto antes) limpia el feedback y
      // el input del escaneo anterior — si no, al entrar a otro repartidor
      // quedaba pegado el resultado ("✓ tracking → Recibido en planta") del
      // último escaneo hecho en el repartidor anterior (bug 2026-11-18).
      if(!yaEstabaAbierto){
        document.getElementById("fallidos-scan-feedback").textContent = "";
        document.getElementById("fallidos-scan-input").value = "";
      }
      document.getElementById("fallidos-scan-input").focus();
    }
  }

  function cerrarDetalleFallidosRepartidor(){
    stateFallidos.choferSeleccionado = null;
    renderFallidos(); // no solo aplicarModoFallidos(): "Por repartidor" tiene
    // que refrescar sus conteos/pendientes con lo que se gestionó adentro
    // del modal (bug 2026-11-18: quedaba desactualizado hasta F5).
  }
  document.getElementById("modal-fallidos-cerrar").addEventListener("click", cerrarDetalleFallidosRepartidor);
  document.getElementById("modal-detalle-fallidos").addEventListener("click", (e)=>{
    if(e.target.id === "modal-detalle-fallidos") cerrarDetalleFallidosRepartidor();
  });

  // Escaneo por pistola QR/código de barras en el detalle de un repartidor
  // (pedido 2026-11-18): misma lógica de extracción de ID que ya usa el
  // sector de Picking (Google Apps Script) — el código trae un payload
  // tipo JSON con "did" (envío Directo, matchea contra id_interno) o
  // "tracking_number"/"id" (Mercadolibre, matchea contra tracking). Al
  // encontrar el pendiente correspondiente, lo marca "Recibido en planta"
  // sin abrir el modal, para procesar varios paquetes seguidos rápido.
  function extraerIdDeCodigoEscaneado(raw){
    const matchDid = raw.match(/(?:^|[^a-zA-Z0-9_])"?did"?\s*:\s*"([^"{}\n\r]+)"/i);
    const matchTracking = raw.match(/(?:^|[^a-zA-Z0-9_])"?tracking_number"?\s*:\s*"([^"{}\n\r]+)"/i);
    const matchId = raw.match(/(?:^|[^a-zA-Z0-9_])"?[iï]d"?\s*:\s*"([^"{}\n\r]+)"/i);
    if(matchDid) return { valor: matchDid[1].trim(), campo: "id_interno" };
    if(matchTracking) return { valor: matchTracking[1].trim(), campo: "tracking" };
    if(matchId) return { valor: matchId[1].trim(), campo: "tracking" };
    return null;
  }

  async function procesarEscaneoFallido(raw){
    const feedback = document.getElementById("fallidos-scan-feedback");
    const extraido = extraerIdDeCodigoEscaneado(raw);
    if(!extraido){
      feedback.style.color = "#c0392b";
      feedback.textContent = `Código no reconocido: "${raw.slice(0, 40)}"`;
      return;
    }
    const pendientesRepa = stateFallidos.filas.filter(f =>
      claveRepartidorEnvio(f.envio) === stateFallidos.choferSeleccionado && f.estatus === "pendiente"
    );
    const fila = pendientesRepa.find(f => String(f.envio[extraido.campo] || "").trim() === extraido.valor);
    if(!fila){
      feedback.style.color = "#c0392b";
      feedback.textContent = `No se encontró "${extraido.valor}" entre los pendientes de este repartidor.`;
      return;
    }
    const payload = {
      estatus: "recibido_planta",
      precio_descuento: fila.seguimiento ? fila.seguimiento.precio_descuento : null,
      motivo_cierre: fila.seguimiento ? fila.seguimiento.motivo_cierre : null,
      observaciones: fila.seguimiento ? fila.seguimiento.observaciones : null,
      fecha_cierre: fechaART(0),
    };
    let error;
    if(fila.seguimiento){
      ({ error } = await sb.from("fallidos_seguimiento").update(payload).eq("id", fila.seguimiento.id));
    } else {
      ({ error } = await sb.from("fallidos_seguimiento").insert({ id_interno: fila.envio.id_interno, duplicado: fila.duplicado, ...payload }));
    }
    if(error){
      console.error("Error marcando recibido en planta por escaneo:", error);
      feedback.style.color = "#c0392b";
      feedback.textContent = "No se pudo guardar.";
      return;
    }
    feedback.style.color = "#1e7e3c";
    feedback.textContent = `✓ ${fila.envio.tracking || fila.envio.id_interno} → Recibido en planta.`;
    await cargarFallidos();
    document.getElementById("fallidos-scan-input").focus();
  }

  document.getElementById("fallidos-scan-input").addEventListener("keydown", (e)=>{
    if(e.key !== "Enter") return;
    e.preventDefault();
    const valor = e.target.value.trim();
    e.target.value = "";
    if(!valor) return;
    procesarEscaneoFallido(valor);
  });

  // La dirección vive en envios_contacto_destinatario (separada de envios
  // a propósito, ver reglas_de_negocio.md) — se trae como embed por FK
  // (ver COLUMNAS_ENVIO_FALLIDOS) y PostgREST la devuelve como objeto
  // (relación 1 a 1) o null si no hay permiso/no existe la fila.
  export function direccionDe(envio){
    const c = envio.envios_contacto_destinatario;
    const fila = Array.isArray(c) ? c[0] : c;
    return (fila && fila.direccion) ? tituloTexto(fila.direccion) : "—";
  }

  // Cordón resuelto por Localidad+CP (pedido 2026-11-23) — reemplaza a la
  // "Zona" cruda de Lightdata en pantalla. Embed por FK (envios.cordon_id
  // -> parametros_cordones), mismo patrón que direccionDe() de arriba.
  // null = todavía sin clasificar (ver pantalla de Localidades).
  export function cordonDe(envio){
    const c = envio.parametros_cordones;
    const fila = Array.isArray(c) ? c[0] : c;
    return (fila && fila.nombre) ? fila.nombre : null;
  }

  function claveSeleccionFallido(f){
    return `${f.envio.id_interno}::${f.seguimiento ? f.seguimiento.id : ""}`;
  }

  // Arma las filas de la tabla de Fallidos — compartida entre "Todos"
  // (#tabla-fallidos) y el modal de detalle por repartidor
  // (#tabla-fallidos-detalle, sin columna Repartidor porque ya está en el
  // título del modal). `colspanVacio` tiene que matchear la cantidad de
  // columnas de cada thead (15 en Todos, 14 en el modal — cuentan el
  // checkbox de selección y Dirección, agregados 2026-11-19).
  function renderTablaFallidos(filas, tbodyId, { incluirRepartidor, colspanVacio, checkTodosId, btnCerrarId, countId }){
    const tbody = document.getElementById(tbodyId);
    if(!filas.length){
      tbody.innerHTML = `<tr><td colspan="${colspanVacio}" class="sin-datos">Sin casos en este filtro.</td></tr>`;
      actualizarToolbarSeleccionFallidos([], checkTodosId, btnCerrarId, countId);
      return;
    }
    tbody.innerHTML = filas.map(f => {
      const alerta = alertaDiasFallido(f.dias);
      const idSeg = f.seguimiento ? f.seguimiento.id : "";
      const idInterno = f.envio.id_interno;
      const origen = f.envio.origen || "—";
      const clave = claveSeleccionFallido(f);
      return `
      <tr>
        <td style="text-align:center;"><input type="checkbox" class="check-fila-fallido" data-clave="${clave}" ${stateFallidos.seleccionados.has(clave) ? "checked" : ""} /></td>
        <td><span class="badge ${alerta.color}">${f.dias === null ? "—" : f.dias + " d"} · ${alerta.label}</span></td>
        <td>${formatearFechaHora(f.envio.fecha_mercadopacks)}</td>
        <td>${f.envio.tracking || "—"}</td>
        <td>${tituloTexto(f.envio.cliente) || "—"}</td>
        <td>${tituloTexto(f.envio.localidad) || "—"}</td>
        <td class="texto-muted">${direccionDe(f.envio)}</td>
        ${incluirRepartidor ? `<td>${tituloNombre(nombreRepartidorFallido(f.envio))}</td>` : ""}
        <td>${tituloTexto(origen)}</td>
        <td>${tituloTexto(f.envio.estado) || "—"}${f.duplicado ? ' <span class="badge gris">Duplicado</span>' : ""}</td>
        <td>${f.tipo}</td>
        <td>${f.destino}</td>
        <td><span class="badge ${f.estatus === "pendiente" ? "amarillo" : "verde"}">${ESTATUS_LABEL_FALLIDOS[f.estatus]}</span></td>
        <td class="texto-muted">${(f.seguimiento && f.seguimiento.observaciones) || "—"}</td>
        <td class="col-opciones">
          <button type="button" class="btn-icono-chico editar" data-id-interno="${idInterno}" data-id-seg="${idSeg}" title="Cambiar estatus"><i data-lucide="pencil"></i></button>
        </td>
      </tr>`;
    }).join("");
    lucide.createIcons();
    actualizarToolbarSeleccionFallidos(filas.map(claveSeleccionFallido), checkTodosId, btnCerrarId, countId);
  }

  // Selección masiva para cerrar varios casos de una (pedido 2026-11-19).
  // `stateFallidos.seleccionados` es compartido entre "Todos" y el modal
  // de detalle, pero cada tabla solo ve/controla las claves que tiene
  // renderizadas en ESE momento (`claves` acá abajo) — así alternar entre
  // pantallas no arrastra selecciones de una tabla a los controles de la
  // otra por error.
  function actualizarToolbarSeleccionFallidos(claves, checkTodosId, btnCerrarId, countId){
    if(!checkTodosId) return; // compatibilidad: llamada sin toolbar (no debería pasar, pero no rompe)
    const seleccionadosEnVista = claves.filter(c => stateFallidos.seleccionados.has(c));
    const checkTodos = document.getElementById(checkTodosId);
    const btn = document.getElementById(btnCerrarId);
    const count = document.getElementById(countId);
    if(checkTodos){
      checkTodos.checked = claves.length > 0 && seleccionadosEnVista.length === claves.length;
      checkTodos.indeterminate = seleccionadosEnVista.length > 0 && seleccionadosEnVista.length < claves.length;
      checkTodos.onchange = () => {
        if(checkTodos.checked) claves.forEach(c => stateFallidos.seleccionados.add(c));
        else claves.forEach(c => stateFallidos.seleccionados.delete(c));
        renderFallidos();
      };
    }
    if(btn) btn.hidden = seleccionadosEnVista.length === 0;
    if(count) count.textContent = seleccionadosEnVista.length;
  }

  function wireSeleccionFilaFallidos(tbodyId, checkTodosId, btnCerrarId, countId){
    document.getElementById(tbodyId).addEventListener("change", (e)=>{
      const check = e.target.closest(".check-fila-fallido");
      if(!check) return;
      const clave = check.dataset.clave;
      if(check.checked) stateFallidos.seleccionados.add(clave);
      else stateFallidos.seleccionados.delete(clave);
      const claves = [...document.getElementById(tbodyId).querySelectorAll(".check-fila-fallido")].map(c => c.dataset.clave);
      actualizarToolbarSeleccionFallidos(claves, checkTodosId, btnCerrarId, countId);
    });
  }
  wireSeleccionFilaFallidos("tabla-fallidos", "check-todos-fallidos", "btn-cerrar-seleccionados-fallidos", "fallidos-seleccionados-count");
  wireSeleccionFilaFallidos("tabla-fallidos-detalle", "check-todos-fallidos-detalle", "btn-cerrar-seleccionados-fallidos-detalle", "fallidos-detalle-seleccionados-count");

  async function cerrarCasosSeleccionados(claves){
    if(!claves.length) return;
    abrirModalAbm(`Cerrar ${claves.length} caso(s) seleccionados`, [
      { clave: "estatus", label: "Estatus", tipo: "select", opciones: Object.entries(ESTATUS_LABEL_FALLIDOS).filter(([v]) => v !== "pendiente").map(([valor, texto]) => ({ valor, texto })) },
      { clave: "precio_descuento", label: "Precio a descontar", tipo: "number", mostrarSi: (v) => v.estatus === "descontar" },
      { clave: "motivo_cierre", label: "Motivo de cierre", tipo: "texto" },
      { clave: "observaciones", label: "Observaciones", tipo: "texto" },
    ], { estatus: "cerrado_manual" }, async (vals)=>{
      if(!vals.estatus || vals.estatus === "pendiente"){ await mostrarAviso("Elegí un estatus para cerrar los casos."); return false; }
      const payload = {
        estatus: vals.estatus,
        precio_descuento: vals.precio_descuento ? Number(vals.precio_descuento) : null,
        motivo_cierre: vals.motivo_cierre || null,
        observaciones: vals.observaciones || null,
        fecha_cierre: fechaART(0),
      };
      for(const clave of claves){
        const [idInterno, idSeg] = clave.split("::");
        const fila = stateFallidos.filas.find(f => f.envio.id_interno === idInterno && (f.seguimiento ? f.seguimiento.id : "") === idSeg);
        if(fila && fila.seguimiento){
          await sb.from("fallidos_seguimiento").update(payload).eq("id", fila.seguimiento.id);
        } else {
          await sb.from("fallidos_seguimiento").insert({ id_interno: idInterno, duplicado: false, ...payload });
        }
      }
      stateFallidos.seleccionados.clear();
      cargarFallidos();
    });
  }
  document.getElementById("btn-cerrar-seleccionados-fallidos").addEventListener("click", ()=>{
    const claves = [...document.getElementById("tabla-fallidos").querySelectorAll(".check-fila-fallido:checked")].map(c => c.dataset.clave);
    cerrarCasosSeleccionados(claves);
  });
  document.getElementById("btn-cerrar-seleccionados-fallidos-detalle").addEventListener("click", ()=>{
    const claves = [...document.getElementById("tabla-fallidos-detalle").querySelectorAll(".check-fila-fallido:checked")].map(c => c.dataset.clave);
    cerrarCasosSeleccionados(claves);
  });

  function renderFallidos(){
    aplicarModoFallidos();
    if(stateFallidos.modo === "repartidor" && !stateFallidos.choferSeleccionado){
      renderKpisFallidos(stateFallidos.filas);
      renderFallidosPorChofer();
      return;
    }

    if(stateFallidos.modo === "repartidor" && stateFallidos.choferSeleccionado){
      // Modal de detalle: siempre los pendientes del repartidor elegido,
      // sin los filtros de Tipo/Destino/Estatus/Búsqueda de "Todos" (son
      // pantallas separadas, no comparten estado).
      let filas = stateFallidos.filas.filter(f =>
        claveRepartidorEnvio(f.envio) === stateFallidos.choferSeleccionado && f.estatus === "pendiente"
      );
      filas = [...filas].sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
      renderKpisFallidos(stateFallidos.filas);
      renderTablaFallidos(filas, "tabla-fallidos-detalle", { incluirRepartidor: false, colspanVacio: 14, checkTodosId: "check-todos-fallidos-detalle", btnCerrarId: "btn-cerrar-seleccionados-fallidos-detalle", countId: "fallidos-detalle-seleccionados-count" });
      return;
    }

    // modo "todos"
    let filas = stateFallidos.filas;
    if(stateFallidos.tipo !== "todos") filas = filas.filter(f => f.tipo === stateFallidos.tipo);
    if(stateFallidos.destino) filas = filas.filter(f => f.destino === stateFallidos.destino);
    if(stateFallidos.estatus === "pendiente") filas = filas.filter(f => f.estatus === "pendiente");
    else if(stateFallidos.estatus === "cerrados") filas = filas.filter(f => f.estatus !== "pendiente");

    renderKpisFallidos(stateFallidos.filas);

    const q = stateFallidos.search;
    if(q){
      filas = filas.filter(f =>
        (f.envio.cadete || "").toLowerCase().includes(q) ||
        (f.envio.cliente || "").toLowerCase().includes(q) ||
        (f.envio.localidad || "").toLowerCase().includes(q) ||
        (f.envio.tracking || "").toLowerCase().includes(q)
      );
    }
    filas = [...filas].sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
    renderTablaFallidos(filas, "tabla-fallidos", { incluirRepartidor: true, colspanVacio: 15, checkTodosId: "check-todos-fallidos", btnCerrarId: "btn-cerrar-seleccionados-fallidos", countId: "fallidos-seleccionados-count" });
  }

  document.querySelectorAll("#modo-fallidos .chip").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#modo-fallidos .chip").forEach(b=>b.classList.toggle("activo", b===btn));
      stateFallidos.modo = btn.dataset.modoFallidos;
      stateFallidos.choferSeleccionado = null;
      aplicarModoFallidos();
      renderFallidos();
    });
  });
  document.getElementById("buscar-fallidos-repartidor").addEventListener("input", (e)=>{
    stateFallidos.searchRepartidor = e.target.value.trim().toLowerCase();
    renderFallidosPorChofer();
  });
  crearPopoverGenerico("popover-filtros-fallidos-repartidor");
  crearComboGenerico("combo-tipo-fallidos-repartidor", (valor)=>{ stateFallidos.tipoRepartidor = valor; renderFallidosPorChofer(); });
  document.querySelectorAll("#fallidos-chofer-lista-card th.ordenable").forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.sort;
      if(stateFallidos.sortChofer.key === key) stateFallidos.sortChofer.dir = stateFallidos.sortChofer.dir === "asc" ? "desc" : "asc";
      else stateFallidos.sortChofer = { key, dir: "desc" };
      renderFallidosPorChofer();
    });
  });
  document.getElementById("tabla-fallidos-por-chofer").addEventListener("click", (e)=>{
    const fila = e.target.closest("tr[data-chofer]");
    if(!fila) return;
    stateFallidos.choferSeleccionado = fila.dataset.chofer;
    stateFallidos.choferSeleccionadoNombre = fila.dataset.choferNombre;
    aplicarModoFallidos();
    renderFallidos();
  });
  document.getElementById("buscar-fallidos").addEventListener("input", (e)=>{
    stateFallidos.search = e.target.value.trim().toLowerCase();
    renderFallidos();
  });
  crearPopoverGenerico("popover-filtros-fallidos");
  crearComboGenerico("combo-tipo-fallidos", (valor)=>{ stateFallidos.tipo = valor; renderFallidos(); });
  crearComboGenerico("combo-destino-fallidos", (valor)=>{ stateFallidos.destino = valor; renderFallidos(); });
  crearComboGenerico("combo-estatus-fallidos", (valor)=>{ stateFallidos.estatus = valor; renderFallidos(); });
  crearComboGenerico("combo-rango-fallidos", (valor)=>{ stateFallidos.rangoDias = Number(valor); cargarFallidos(); });

  function abrirEdicionFallido(idInterno, idSeg){
    const fila = stateFallidos.filas.find(f =>
      f.envio.id_interno === idInterno && (f.seguimiento ? f.seguimiento.id : "") === idSeg
    );
    if(!fila) return;
    abrirModalAbm(`Caso: ${fila.envio.tracking || idInterno}`, [
      { clave: "estatus", label: "Estatus", tipo: "select", opciones: Object.entries(ESTATUS_LABEL_FALLIDOS).map(([valor, texto]) => ({ valor, texto })) },
      { clave: "precio_descuento", label: "Precio a descontar", tipo: "number", mostrarSi: (v) => v.estatus === "descontar" },
      { clave: "motivo_cierre", label: "Motivo de cierre", tipo: "texto" },
      { clave: "observaciones", label: "Observaciones", tipo: "texto" },
    ], fila.seguimiento || { estatus: "pendiente" }, async (vals)=>{
      const payload = {
        estatus: vals.estatus || "pendiente",
        precio_descuento: vals.precio_descuento ? Number(vals.precio_descuento) : null,
        motivo_cierre: vals.motivo_cierre || null,
        observaciones: vals.observaciones || null,
        fecha_cierre: vals.estatus && vals.estatus !== "pendiente" ? fechaART(0) : null,
      };
      let error;
      if(fila.seguimiento){
        ({ error } = await sb.from("fallidos_seguimiento").update(payload).eq("id", fila.seguimiento.id));
      } else {
        ({ error } = await sb.from("fallidos_seguimiento").insert({ id_interno: idInterno, duplicado: false, ...payload }));
      }
      if(error){ console.error(error); await mostrarAviso("No se pudo guardar."); return false; }
      cargarFallidos();
    });
  }
  document.getElementById("tabla-fallidos").addEventListener("click", (e)=>{
    const btn = e.target.closest(".btn-icono-chico.editar");
    if(btn) abrirEdicionFallido(btn.dataset.idInterno, btn.dataset.idSeg);
  });
  document.getElementById("tabla-fallidos-detalle").addEventListener("click", (e)=>{
    const btn = e.target.closest(".btn-icono-chico.editar");
    if(btn) abrirEdicionFallido(btn.dataset.idInterno, btn.dataset.idSeg);
  });

  // ----- Marcar duplicado: buscar el envío real y agregarle una segunda fila de seguimiento -----
  let duplicadoBuscarTimeout = null;
  async function buscarEnviosParaDuplicado(texto){
    const tbody = document.getElementById("tabla-buscar-duplicado");
    if(!texto || texto.length < 2){
      tbody.innerHTML = `<tr><td colspan="6" class="sin-datos">Escribí al menos 2 caracteres.</td></tr>`;
      return;
    }
    const { data, error } = await sb.from("envios")
      .select("id_interno,tracking,cliente,localidad,cadete,estado")
      .or(`tracking.ilike.%${texto}%,cliente.ilike.%${texto}%,localidad.ilike.%${texto}%`)
      .limit(20);
    if(error){ console.error(error); tbody.innerHTML = `<tr><td colspan="6" class="sin-datos">Error buscando.</td></tr>`; return; }
    if(!data || !data.length){
      tbody.innerHTML = `<tr><td colspan="6" class="sin-datos">Sin resultados.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(e => `
      <tr>
        <td>${e.tracking || "—"}</td>
        <td>${e.cliente || "—"}</td>
        <td>${e.localidad || "—"}</td>
        <td>${tituloNombre(e.cadete) || "—"}</td>
        <td>${e.estado || "—"}</td>
        <td><button type="button" class="btn-secundario-modal btn-marcar-duplicado" data-id-interno="${e.id_interno}">Marcar duplicado</button></td>
      </tr>`).join("");
  }
  document.getElementById("btn-agregar-duplicado").addEventListener("click", ()=>{
    document.getElementById("buscar-duplicado-fallidos").value = "";
    document.getElementById("tabla-buscar-duplicado").innerHTML = `<tr><td colspan="6" class="sin-datos">Buscá un envío arriba.</td></tr>`;
    document.getElementById("modal-duplicado-fallidos").hidden = false;
  });
  document.getElementById("modal-duplicado-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-duplicado-fallidos").hidden = true;
  });
  document.getElementById("buscar-duplicado-fallidos").addEventListener("input", (e)=>{
    clearTimeout(duplicadoBuscarTimeout);
    const texto = e.target.value.trim();
    duplicadoBuscarTimeout = setTimeout(() => buscarEnviosParaDuplicado(texto), 300);
  });
  document.getElementById("tabla-buscar-duplicado").addEventListener("click", async (e)=>{
    const btn = e.target.closest(".btn-marcar-duplicado");
    if(!btn) return;
    const { error } = await sb.from("fallidos_seguimiento").insert({
      id_interno: btn.dataset.idInterno, duplicado: true, estatus: "pendiente",
      observaciones: "Hay más de un paquete físico en el sector para este envío.",
    });
    if(error){ console.error(error); await mostrarAviso("No se pudo marcar como duplicado."); return; }
    document.getElementById("modal-duplicado-fallidos").hidden = true;
    cargarFallidos();
  });
