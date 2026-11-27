// Asistencia de Repartidores (tabla editable, reemplaza la planilla de
// Google Sheets) + Operación en vivo (pantalla de consulta).
// Viene de index.html (Etapa 3c de migración a ES Modules, 2026-11-25).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { tituloNombre } from "../core/formato.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { crearComboGenerico, crearPopoverGenerico } from "../ui/combos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";
import { abmVehiculos, abmZonas } from "../admin/abm-simple.js";
import { abmTurnos } from "../admin/abm-turnos.js";
import { abmLocalidades } from "../admin/abm-localidades.js";
import { fechaART } from "../core/fechas.js";
import { _pct, _fmtPct } from "../core/porcentajes.js";
import { stateFallidos, cargarFallidos, normEspaciosNombre, claveRepartidorEnvio, claveRepartidorAsistencia } from "./fallidos.js";

  // ======================================================================
  // Asistencia de Repartidores — reemplaza la planilla de Google Sheets.
  // Una fila por chofer asignado ese día en public.asistencia_diaria;
  // cualquier usuario autenticado puede leer/escribir (mismo criterio que
  // hoy: Soporte y Depósito editan la misma fila a lo largo del día, sin
  // fórmulas de por medio).
  // ======================================================================

  const TOLERANCIA_PUNTUALIDAD_MIN = 15;
  const stateAsistencia = {
    modoFecha: "hoy", fechaElegida: null, search: "", zona: "global", filas: [],
    filtrosCol: { vehiculo: "", estado: "" }, sort: { key: null, dir: "asc" },
  };

  function diaDeSemanaAsistencia(fechaISO){
    const [y,m,d] = fechaISO.split("-").map(Number);
    return new Date(y, m-1, d).getDay(); // 0=domingo ... 6=sábado
  }

  function fechaAsistenciaActual(){
    if(stateAsistencia.modoFecha === "ayer") return fechaART(-1);
    if(stateAsistencia.modoFecha === "elegir") return stateAsistencia.fechaElegida || fechaART(0);
    return fechaART(0);
  }

  crearComboGenerico("combo-fecha-asistencia", (valor)=>{
    stateAsistencia.modoFecha = valor;
    const wrap = document.getElementById("fecha-asistencia-wrap");
    if(valor === "elegir"){
      wrap.hidden = false;
      const input = document.getElementById("fecha-asistencia-input");
      if(!input.value) input.value = fechaART(0);
      stateAsistencia.fechaElegida = input.value;
    } else {
      wrap.hidden = true;
    }
    cargarAsistencia();
  });
  document.getElementById("fecha-asistencia-input").addEventListener("change", (e)=>{
    stateAsistencia.fechaElegida = e.target.value;
    cargarAsistencia();
  });
  document.getElementById("buscar-asistencia").addEventListener("input", (e)=>{
    stateAsistencia.search = e.target.value.toLowerCase();
    renderAsistencia();
  });
  crearComboGenerico("combo-zona-asistencia", (valor)=>{
    stateAsistencia.zona = valor;
    renderAsistencia();
  });
  crearComboGenerico("combo-vehiculo-asistencia", (valor)=>{
    stateAsistencia.filtrosCol.vehiculo = valor.toLowerCase();
    renderAsistencia();
  });
  crearComboGenerico("combo-estado-asistencia", (valor)=>{
    stateAsistencia.filtrosCol.estado = valor;
    renderAsistencia();
  });

  // Popover "Filtrar" (Vehículo + Estado) de Asistencia — mismo singleton
  // que el resto (crearPopoverGenerico), para que no se superponga con
  // "Columnas" ni con ningún otro combo abierto.
  crearPopoverGenerico("popover-filtros-asistencia");

  document.querySelectorAll('#vista-repa-asistencia th.ordenable').forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.sort;
      if(stateAsistencia.sort.key === key) stateAsistencia.sort.dir = stateAsistencia.sort.dir === "asc" ? "desc" : "asc";
      else stateAsistencia.sort = { key, dir: "asc" };
      renderAsistencia();
    });
  });

  export async function cargarAsistencia(){
    const fecha = fechaAsistenciaActual();
    // cargarFallidos() en paralelo: calcularEstadoChofer() necesita
    // stateFallidos.filas para "N fallidos pendientes" (ver
    // contarFallidosPendientesPorRepartidor, pedido 2026-11-18) aunque
    // nunca se haya entrado a la pantalla de Fallidos y Cambios.
    const [{ data: filas, error }] = await Promise.all([
      sb.from("asistencia_diaria").select("*").eq("fecha", fecha).order("id"),
      cargarFallidos(),
    ]);
    if(error){
      console.error("Error cargando asistencia_diaria:", error);
      document.getElementById("tabla-asistencia").innerHTML = `<tr><td colspan="13" class="sin-datos">Error cargando los datos.</td></tr>`;
      return;
    }
    stateAsistencia.filas = filas || [];
    renderAsistencia();
  }

  // Los indicadores (% asistencia, % llegada a tiempo, % pallet retirado)
  // ya se muestran en "Operación en vivo" — no hace falta repetirlos acá
  // (esta pantalla es la operativa, la de consulta es la otra).
  function horaATimestamp(fecha, horaStr){
    if(!horaStr) return null;
    return new Date(`${fecha}T${horaStr}`).getTime();
  }

  // Columnas de paso a paso, en el mismo orden secuencial que la planilla
  // vieja (J,L,M,O,Q,S,U) — ver reglas_de_negocio.md para el detalle del
  // flujo Soporte/Depósito.
  const COLUMNAS_BOOL_ASISTENCIA = [
    "asiste_soporte",
    "pallet_listo_deposito", "confirma_retiro_soporte", "llego_deposito",
    "pallet_retirado_deposito",
  ];
  const COLUMNAS_HORA_ASISTENCIA = [
    "hora_aviso_soporte", "hora_pallet_listo",
    "hora_confirma_retiro", "hora_llegada", "hora_pallet_retirado",
  ];

  // "Tiene fallidos"/"Fallidos recibidos" dejaron de ser checkboxes manuales
  // acá (pedido 2026-11-18) — se calculan en vivo contra Fallidos y Cambios,
  // que ya es la fuente real de esa información (incluido lo que marca el
  // escaneo QR como "Recibido en planta"). Devuelve nombre -> cantidad de
  // casos con Estatus "Pendiente" asignados a ese repartidor.
  // Indexa cada pendiente bajo las DOS claves posibles (por ID de
  // Lightdata y por nombre normalizado), no solo la "mejor" — si no, un
  // repartidor con el envío ya vinculado por ID pero cuya fila de
  // asistencia_diaria todavía no tiene lightdata_id (filas de antes de
  // este cambio, ver claveRepartidorAsistencia) nunca matchea aunque sea
  // la misma persona (bug real 2026-11-19, caso Fiorella Souza: envíos
  // con chofer_lightdata_id=1093, asistencia con lightdata_id=null).
  function contarFallidosPendientesPorRepartidor(){
    const mapa = new Map();
    for(const f of stateFallidos.filas){
      if(f.estatus !== "pendiente") continue;
      const claves = new Set([
        claveRepartidorEnvio(f.envio),
        `nombre:${normEspaciosNombre(f.envio.cadete) || "Sin repartidor"}`,
      ]);
      for(const clave of claves){
        mapa.set(clave, (mapa.get(clave) || 0) + 1);
      }
    }
    return mapa;
  }

  // Réplica del ESTADO DEL CHOFER de la planilla (fórmula decodificada del
  // Sheet real) — es un valor calculado en el momento, no se guarda en la
  // base, así que siempre refleja el estado actual de los checks.
  // El ícono depende del PASO en el que está (no solo del color): dos
  // estados pueden compartir color (p.ej. "amarillo") pero son pasos muy
  // distintos del proceso — pedido 2026-11-15: con un ícono por color
  // nada más, varias combinaciones de checks distintas terminaban
  // mostrando el mismo dibujito, y la única forma de notar la diferencia
  // era leyendo el tooltip. Ahora cada uno de los 8 estados posibles
  // tiene su propio ícono, y el color sigue marcando la urgencia.
  function calcularEstadoChofer(f){
    let base, color, icono;
    if(f.pallet_retirado_deposito){ base = "Retirado / En ruta"; color = "verde"; icono = "check-circle-2"; }
    else if(f.llego_deposito){
      if(f.pallet_listo_deposito){ base = "Pallet listo para retirar"; color = "azul"; icono = "package-check"; }
      else { base = "Llegó - Sin pallet"; color = "azul"; icono = "door-open"; }
    }
    else if(f.confirma_retiro_soporte){ base = "En camino al depósito"; color = "azul"; icono = "truck"; }
    else if(f.pallet_listo_deposito){
      if(f.asiste_soporte){ base = "Pallet listo - esperando repartidor"; color = "amarillo"; icono = "package"; }
      else { base = "No asiste - pallet armado"; color = "rojo"; icono = "alert-triangle"; }
    }
    else if(f.asiste_soporte){ base = "Asistencia confirmada"; color = "amarillo"; icono = "check"; }
    else { base = "Sin confirmar / No asiste"; color = "gris"; icono = "circle-dashed"; }

    const pendientes = contarFallidosPendientesPorRepartidor().get(claveRepartidorAsistencia(f)) || 0;
    if(pendientes > 0){
      base += ` · ${pendientes} fallido${pendientes === 1 ? "" : "s"} pendiente${pendientes === 1 ? "" : "s"}`;
      if(color !== "rojo") color = "amarillo";
    }
    return { label: base, color, icono };
  }

  const COLUMNAS_TEXTO_ASISTENCIA = ["zona", "tipo_vehiculo", "localidades", "observaciones"];

  async function guardarCampoAsistencia(id, campo, valor){
    const { error } = await sb.from("asistencia_diaria").update({ [campo]: valor }).eq("id", id);
    if(error) console.error(`Error guardando ${campo} (fila ${id}):`, error);
  }

  function renderAsistencia(){
    let filas = stateAsistencia.filas;
    if(stateAsistencia.zona !== "global") filas = filas.filter(f => (f.zona || "") === stateAsistencia.zona);
    if(stateAsistencia.search) filas = filas.filter(f => (f.nombre || "").toLowerCase().includes(stateAsistencia.search));
    const filtroVeh = stateAsistencia.filtrosCol.vehiculo;
    if(filtroVeh) filas = filas.filter(f => (f.tipo_vehiculo || "").toLowerCase() === filtroVeh);
    const filtroEstado = stateAsistencia.filtrosCol.estado;
    if(filtroEstado) filas = filas.filter(f => calcularEstadoChofer(f).color === filtroEstado);

    const ORDEN_CAMPOS_ASISTENCIA = {
      nombre: f => (f.nombre || "").toLowerCase(),
      tipo_vehiculo: f => (f.tipo_vehiculo || "").toLowerCase(),
      turno: f => f.turno || "99:99",
      zona: f => (f.zona || "").toLowerCase(),
      estado: f => calcularEstadoChofer(f).label,
    };
    const { key, dir } = stateAsistencia.sort;
    if(key){
      const accessor = ORDEN_CAMPOS_ASISTENCIA[key];
      filas = filas.slice().sort((a, b)=>{
        const va = accessor(a), vb = accessor(b);
        if(va < vb) return dir === "asc" ? -1 : 1;
        if(va > vb) return dir === "asc" ? 1 : -1;
        return 0;
      });
    }
    document.querySelectorAll("#vista-repa-asistencia th.ordenable").forEach(th=>{
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

    const tbody = document.getElementById("tabla-asistencia");
    if(!filas.length){
      tbody.innerHTML = `<tr><td colspan="13" class="sin-datos">Sin repartidores cargados para esta fecha. Usá "Agregar repartidor" para empezar.</td></tr>`;
      return;
    }

    tbody.innerHTML = filas.map(f => {
      const estado = calcularEstadoChofer(f);
      let html = `<tr data-id="${f.id}">`;
      html += `<td class="celda-texto-solo">${(f.nombre || "(sin nombre)")}</td>`;
      html += `<td class="celda-texto-solo${f.tipo_vehiculo ? "" : " muted"}" data-col="tipo_vehiculo">${f.tipo_vehiculo || "—"}</td>`;
      html += `<td class="celda-texto-solo${f.turno ? "" : " muted"}" data-col="turno">${f.turno ? f.turno.slice(0,5) : "—"}</td>`;
      html += `<td class="celda-texto-solo${f.zona ? "" : " muted"}" data-col="zona" title="${(f.zona || "").replace(/"/g, "&quot;")}">${f.zona || "—"}</td>`;
      html += `<td class="celda-texto-solo${f.localidades ? "" : " muted"}" data-col="localidades" title="${(f.localidades || "").replace(/"/g, "&quot;")}">${f.localidades || "—"}</td>`;
      html += `<td data-col="observaciones"><input class="cel-input ancho" data-campo="observaciones" placeholder="Ej: no asiste hoy" value="${(f.observaciones || "").replace(/"/g, "&quot;")}" /></td>`;
      html += `<td style="text-align:center;" data-col="asiste_soporte"><input type="checkbox" class="cel-input" data-campo="asiste_soporte" ${f.asiste_soporte ? "checked" : ""} /></td>`;
      html += `<td style="text-align:center;" data-col="pallet_listo_deposito"><input type="checkbox" class="cel-input" data-campo="pallet_listo_deposito" ${f.pallet_listo_deposito ? "checked" : ""} /></td>`;
      html += `<td style="text-align:center;" data-col="confirma_retiro_soporte"><input type="checkbox" class="cel-input" data-campo="confirma_retiro_soporte" ${f.confirma_retiro_soporte ? "checked" : ""} /></td>`;
      html += `<td style="text-align:center;" data-col="llego_deposito"><input type="checkbox" class="cel-input" data-campo="llego_deposito" ${f.llego_deposito ? "checked" : ""} /></td>`;
      html += `<td style="text-align:center;" data-col="pallet_retirado_deposito"><input type="checkbox" class="cel-input" data-campo="pallet_retirado_deposito" ${f.pallet_retirado_deposito ? "checked" : ""} /></td>`;
      html += `<td class="col-estado-asist"><span class="estado-icono-fila ${estado.color}" tabindex="0" role="img" data-tip="${estado.label.replace(/"/g, "&quot;")}"><i data-lucide="${estado.icono}"></i></span></td>`;
      html += `<td class="col-opciones"><span class="opciones-fila">`;
      html += `<button type="button" class="btn-icono-chico editar" title="Editar datos del repartidor" data-id="${f.id}"><i data-lucide="pencil"></i></button>`;
      html += `<button type="button" class="btn-icono-chico detalle" title="Ver detalle (horas, impreso)" data-id="${f.id}"><i data-lucide="list"></i></button>`;
      html += `<button type="button" class="btn-icono-chico borrar" title="Borrar fila" data-id="${f.id}"><i data-lucide="trash-2"></i></button>`;
      html += `</span></td>`;
      html += `</tr>`;
      return html;
    }).join("");
    lucide.createIcons();
    aplicarColumnasVisiblesAsistencia();
  }

  // Autoguardado por celda: delegado en el tbody (las filas se redibujan
  // enteras en cada carga, así que el listener va en el contenedor fijo).
  // El auto-estampado de hora (K,N,P,R,T,V en el Sheet: se graba la primera
  // vez que el check pasa a true, se limpia si vuelve a false) se replica
  // acá, ya que son las que alimentan los indicadores.
  const CHECK_A_HORA = {
    asiste_soporte: "hora_aviso_soporte",
    pallet_listo_deposito: "hora_pallet_listo",
    confirma_retiro_soporte: "hora_confirma_retiro",
    llego_deposito: "hora_llegada",
    pallet_retirado_deposito: "hora_pallet_retirado",
  };

  document.getElementById("tabla-asistencia").addEventListener("change", (e)=>{
    const input = e.target.closest(".cel-input");
    if(!input) return;
    const tr = input.closest("tr");
    const id = Number(tr.dataset.id);
    const campo = input.dataset.campo;
    const valor = input.type === "checkbox" ? input.checked : (input.value || null);
    const fila = stateAsistencia.filas.find(f => f.id === id);
    if(!fila) return;

    // Optimista: se actualiza el estado local y se repinta YA, sin esperar
    // la ida y vuelta a Supabase — el guardado real va en paralelo, abajo.
    // (bug real 2026-11-15: esperar el `await` antes de repintar hacía
    // sentir que el ícono de Estado "no cambiaba" al tildar un check,
    // cuando en realidad solo estaba demorado por la red).
    fila[campo] = valor;
    const cambios = { [campo]: valor };

    const campoHora = CHECK_A_HORA[campo];
    if(campoHora){
      const nuevaHora = valor ? (fila[campoHora] || new Date().toTimeString().slice(0,8)) : null;
      if(nuevaHora !== fila[campoHora]){
        fila[campoHora] = nuevaHora;
        cambios[campoHora] = nuevaHora;
      }
    }

    if(COLUMNAS_BOOL_ASISTENCIA.includes(campo)){
      renderAsistencia(); // recalcula y repinta el ícono de Estado al instante
    }

    (async ()=>{
      for(const [c, v] of Object.entries(cambios)){
        await guardarCampoAsistencia(id, c, v);
      }
    })();
  });

  document.getElementById("tabla-asistencia").addEventListener("click", async (e)=>{
    const btnEditar = e.target.closest(".btn-icono-chico.editar");
    if(btnEditar){
      abrirEditarChoferAsistencia(Number(btnEditar.dataset.id));
      return;
    }
    const btnDetalle = e.target.closest(".btn-icono-chico.detalle");
    if(btnDetalle){
      abrirDetalleAsistencia(Number(btnDetalle.dataset.id));
      return;
    }
    const btn = e.target.closest(".btn-icono-chico.borrar");
    if(!btn) return;
    const id = Number(btn.dataset.id);
    if(!(await mostrarConfirmacion("¿Borrar esta fila? No se puede deshacer."))) return;
    const { error } = await sb.from("asistencia_diaria").delete().eq("id", id);
    if(error){ console.error("Error borrando fila:", error); return; }
    stateAsistencia.filas = stateAsistencia.filas.filter(f => f.id !== id);
    renderAsistencia();
  });

  // Los datos "de roster" (nombre, vehículo, turno, zona, localidades) son
  // de solo lectura en la tabla — pedido 2026-11-15: se editaban sin
  // querer con un solo click. Para cambiarlos hace falta pasar por este
  // modal, como el resto de los ABM del sistema.
  function abrirEditarChoferAsistencia(id){
    const f = stateAsistencia.filas.find(x => x.id === id);
    if(!f) return;
    abrirModalAbm("Editar repartidor", [
      { clave: "nombre", label: "Nombre", tipo: "texto" },
      { clave: "tipo_vehiculo", label: "Vehículo", tipo: "select", opciones: abmVehiculos.obtenerActivos() },
      { clave: "turno", label: "Turno", tipo: "select", opciones: abmTurnos.obtenerActivos() },
      { clave: "zona", label: "Zona", tipo: "select", opciones: abmZonas.obtenerActivos() },
      { clave: "localidades", label: "Localidades", tipo: "multiselect", opciones: abmLocalidades.obtenerActivos() },
    ], { ...f, turno: f.turno ? f.turno.slice(0,5) : "" }, async (vals)=>{
      if(!vals.nombre){ await mostrarAviso("El nombre es obligatorio."); return false; }
      if(vals.turno === "") vals.turno = null;
      const { error } = await sb.from("asistencia_diaria").update(vals).eq("id", id);
      if(error){ console.error("Error editando chofer:", error); await mostrarAviso("No se pudo guardar."); return false; }
      Object.assign(f, vals);
      renderAsistencia();
    });
  }

  // Selector de columnas: oculta/muestra columnas no esenciales para que
  // entre toda la tabla sin scroll horizontal. Se recuerda por navegador
  // (localStorage), no por usuario de Supabase.
  const LS_COLUMNAS_ASISTENCIA = "mp_asistencia_columnas_ocultas";
  function columnasOcultasGuardadas(){
    try { return new Set(JSON.parse(localStorage.getItem(LS_COLUMNAS_ASISTENCIA) || "[]")); }
    catch { return new Set(); }
  }
  function guardarColumnasOcultas(set){
    try { localStorage.setItem(LS_COLUMNAS_ASISTENCIA, JSON.stringify([...set])); } catch {}
  }
  function aplicarColumnasVisiblesAsistencia(){
    const ocultas = columnasOcultasGuardadas();
    document.querySelectorAll("#tabla-asistencia-el [data-col]").forEach(el=>{
      el.classList.toggle("col-oculta", ocultas.has(el.dataset.col));
    });
  }
  document.querySelectorAll("#popover-columnas-asistencia .check-columna input").forEach(chk=>{
    const ocultas = columnasOcultasGuardadas();
    chk.checked = !ocultas.has(chk.dataset.col);
    chk.addEventListener("change", ()=>{
      const set = columnasOcultasGuardadas();
      if(chk.checked) set.delete(chk.dataset.col); else set.add(chk.dataset.col);
      guardarColumnasOcultas(set);
      aplicarColumnasVisiblesAsistencia();
    });
  });
  crearPopoverGenerico("popover-columnas-asistencia");

  function abrirDetalleAsistencia(id){
    const f = stateAsistencia.filas.find(x => x.id === id);
    if(!f) return;
    document.getElementById("modal-detalle-asistencia-titulo").textContent = `Detalle — ${tituloNombre(f.nombre) || "(sin nombre)"}`;
    const lineas = [
      ["Aviso de asistencia (soporte)", f.hora_aviso_soporte],
      ["Fallidos pendientes (Fallidos y Cambios)", contarFallidosPendientesPorRepartidor().get(claveRepartidorAsistencia(f)) || 0],
      ["Pallet listo (depósito)", f.pallet_listo_deposito ? f.hora_pallet_listo : "—"],
      ["Confirma retiro (soporte)", f.confirma_retiro_soporte ? f.hora_confirma_retiro : "—"],
      ["Llegó a depósito", f.llego_deposito ? f.hora_llegada : "—"],
      ["Pallet retirado (depósito)", f.pallet_retirado_deposito ? f.hora_pallet_retirado : "—"],
      ["Asignación de ruta impresa", f.impreso ? "Sí" : "No"],
    ];
    document.getElementById("modal-detalle-asistencia-cuerpo").innerHTML = lineas.map(([label, valor]) => `
      <div class="linea-detalle-asist"><span>${label}</span><span class="hora-detalle">${(valor || "—").toString().slice(0,8) || "—"}</span></div>
    `).join("");
    document.getElementById("modal-detalle-asistencia").hidden = false;
    document.getElementById("modal-detalle-asistencia-reimprimir").dataset.id = id;
  }
  document.getElementById("modal-detalle-asistencia-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-detalle-asistencia").hidden = true;
  });
  document.getElementById("modal-detalle-asistencia").addEventListener("click", (e)=>{
    if(e.target.id === "modal-detalle-asistencia") document.getElementById("modal-detalle-asistencia").hidden = true;
  });
  // Reimprimir una asignación de ruta puntual (ya impresa o no) sin pasar
  // por el flujo masivo de "pendientes" — responde al pedido del usuario
  // de poder reimprimir una que ya se había impreso.
  document.getElementById("modal-detalle-asistencia-reimprimir").addEventListener("click", async ()=>{
    const id = Number(document.getElementById("modal-detalle-asistencia-reimprimir").dataset.id);
    const f = stateAsistencia.filas.find(x => x.id === id);
    if(!f) return;
    await imprimirAsignacionesDeRuta([f]);
  });

  // Construye y abre la ventana de impresión para un lote de asignaciones
  // de ruta (reemplaza generarRutasPDF() del Apps Script). Reutilizada
  // tanto por "Imprimir hojas de ruta" (lote de pendientes) como por
  // "Reimprimir" (una sola fila, desde el detalle).
  function construirHtmlAsignacionesRuta(filas, fechaHoja){
    const hojas = filas.map(f => `
      <section class="hoja">
        <div class="marca"><span class="marca-mercado">Mercado</span><span class="marca-packs">Packs</span></div>
        <h1>Asignación de ruta — ${fechaHoja.split("-").reverse().join("/")}</h1>
        <div class="fila-dato"><span class="etiqueta">Repartidor</span><span class="valor">${tituloNombre(f.nombre) || "—"}</span></div>
        <div class="fila-dato"><span class="etiqueta">Vehículo</span><span class="valor">${f.tipo_vehiculo || "—"}</span></div>
        <div class="fila-dato"><span class="etiqueta">Turno</span><span class="valor">${f.turno ? f.turno.slice(0,5) : "—"}</span></div>
        <div class="fila-dato"><span class="etiqueta">Zona</span><span class="valor">${f.zona || "—"}</span></div>
        <div class="fila-dato"><span class="etiqueta">Localidades</span><span class="valor">${f.localidades || "—"}</span></div>
        <div class="fila-dato"><span class="etiqueta">Observaciones</span><span class="valor">${f.observaciones || "—"}</span></div>
      </section>
    `).join("");
    return `
      <!doctype html><html><head><meta charset="utf-8"><title>Asignación de ruta</title>
      <style>
        body{font-family:"Nunito",Arial,sans-serif; color:#1a1710; margin:0;}
        .hoja{page-break-after:always; padding:48px;}
        .hoja:last-child{page-break-after:auto;}
        .marca{font-size:15px; font-weight:800; margin-bottom:24px;}
        .marca-mercado{color:#1a1710;} .marca-packs{color:#F5B106;}
        h1{font-size:19px; border-bottom:3px solid #F5B106; padding-bottom:12px; margin:0 0 20px;}
        .fila-dato{display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid #e3e0d6; font-size:15px;}
        .fila-dato .etiqueta{color:#777; text-transform:uppercase; font-size:12px; letter-spacing:.03em;}
        .fila-dato .valor{font-weight:700; font-size:17px;}
      </style>
      </head><body>${hojas}</body></html>
    `;
  }

  // El confirm (cuando corresponde) va ANTES de abrir la ventana, no
  // después: abre la ventana de impresión directamente y, al terminar de
  // imprimir, marca "Impreso" sola (evento afterprint) — sin un segundo
  // cartel de confirmación al volver a la pestaña (bug real 2026-11-15:
  // el orden viejo confundía porque el cartel aparecía recién al volver).
  async function imprimirAsignacionesDeRuta(filas){
    if(!filas.length) return;
    const fechaHoja = fechaAsistenciaActual();
    const ventana = window.open("", "_blank");
    if(!ventana){ await mostrarAviso("El navegador bloqueó la ventana de impresión. Habilitá los pop-ups para este sitio e intentá de nuevo."); return; }
    ventana.document.open();
    ventana.document.write(construirHtmlAsignacionesRuta(filas, fechaHoja));
    ventana.document.close();

    async function marcarImpresoYCerrar(){
      const ids = filas.map(f => f.id);
      const { error } = await sb.from("asistencia_diaria").update({ impreso: true }).in("id", ids);
      if(error){ console.error("Error marcando impreso:", error); return; }
      ids.forEach(id => { const fila = stateAsistencia.filas.find(f => f.id === id); if(fila) fila.impreso = true; });
      renderAsistencia();
    }
    ventana.onafterprint = () => { marcarImpresoYCerrar(); ventana.close(); };
    ventana.onload = () => { ventana.focus(); ventana.print(); };
  }

  document.getElementById("btn-imprimir-rutas").addEventListener("click", async ()=>{
    const pendientes = stateAsistencia.filas.filter(f => f.asiste_soporte && !f.impreso);
    if(!pendientes.length){ await mostrarAviso("No hay asignaciones de ruta pendientes de imprimir (todos los repartidores que asisten ya tienen la suya impresa — podés reimprimir una puntual desde su ícono de Detalle)."); return; }
    if(!(await mostrarConfirmacion(`¿Imprimir las ${pendientes.length} asignación(es) de ruta pendientes? Al terminar de imprimir se marcan automáticamente como "Impreso".`))) return;
    await imprimirAsignacionesDeRuta(pendientes);
  });

  // "Cargar choferes de mañana": reemplaza prepararSiguienteDia() del
  // Apps Script. A diferencia del Sheet, acá no hace falta archivar ni
  // limpiar nada (cada fecha vive en su propia fila para siempre) — solo
  // hay que sembrar mañana con el roster activo (y, si mañana es sábado,
  // filtrado por "asiste sábado"). Usa upsert con ignoreDuplicates para
  // poder tocar el botón de nuevo sin duplicar choferes ya cargados.
  document.getElementById("btn-cargar-manana").addEventListener("click", async ()=>{
    const manana = fechaART(1);
    const diaSemana = diaDeSemanaAsistencia(manana);
    if(diaSemana === 0){ await mostrarAviso("Mañana es domingo: no hay operación, no se carga nada."); return; }

    const query = sb.from("choferes_roster").select("nombre,tipo_vehiculo,turno,zona,localidades,asiste_sabado,es_backup,lightdata_id").eq("activo", true);
    const { data: roster, error } = diaSemana === 6 ? await query.eq("asiste_sabado", true) : await query;
    if(error){ console.error("Error cargando choferes_roster:", error); await mostrarAviso("No se pudo cargar el roster."); return; }
    if(!roster || !roster.length){ await mostrarAviso("No hay repartidores activos en el roster para cargar."); return; }

    if(!(await mostrarConfirmacion(`¿Cargar ${roster.length} repartidor(es) del roster para mañana (${manana.split("-").reverse().join("/")})? Los que ya estén cargados para esa fecha no se duplican.`))) return;

    const filasNuevas = roster
      .slice()
      .sort((a, b) => {
        if(!!a.es_backup !== !!b.es_backup) return a.es_backup ? 1 : -1; // backups al final
        return (a.turno || "99:99").localeCompare(b.turno || "99:99");
      })
      .map(r => ({
        fecha: manana, nombre: r.nombre, tipo_vehiculo: r.tipo_vehiculo,
        turno: r.turno, zona: r.zona, localidades: r.localidades, lightdata_id: r.lightdata_id,
      }));

    const { error: errorInsert } = await sb.from("asistencia_diaria")
      .upsert(filasNuevas, { onConflict: "fecha,nombre,turno", ignoreDuplicates: true });
    if(errorInsert){ console.error("Error cargando choferes de mañana:", errorInsert); await mostrarAviso("No se pudo cargar a los repartidores de mañana."); return; }

    await mostrarAviso(`Listo. Se cargaron los repartidores del roster para el ${manana.split("-").reverse().join("/")}. Cambiá la fecha de arriba a "Elegir fecha…" para verlos.`);
  });

  // ======================================================================
  // Operación en vivo — pantalla de CONSULTA (no se edita acá, los checks
  // se tildan en "Asistencia de Repartidores"). Agrupa la asistencia de
  // hoy por zona y arma la lista de alertas, reemplaza lo que hoy se mira
  // en producción. Reutiliza COLUMNAS_BOOL_ASISTENCIA / calcularEstadoChofer.
  // ======================================================================
  export async function cargarOperacionVivo(){
    const fecha = fechaART(0);
    const [{ data: filas, error }] = await Promise.all([
      sb.from("asistencia_diaria").select("*").eq("fecha", fecha).order("zona"),
      cargarFallidos(), // ver nota en cargarAsistencia()
    ]);
    if(error){ console.error("Error cargando Operación en vivo:", error); return; }
    renderOperacionVivo(filas || []);
  }

  function renderOperacionVivo(filas){
    const total = filas.length;
    const asistenciaSi = filas.filter(f => f.asiste_soporte).length;
    const palletRetiradoSi = filas.filter(f => f.pallet_retirado_deposito).length;
    const conLlegada = filas.filter(f => f.hora_llegada);
    const fecha = fechaART(0);
    const aTiempo = conLlegada.filter(f => {
      const llegada = horaATimestamp(fecha, f.hora_llegada);
      const turno = horaATimestamp(fecha, f.turno);
      return llegada !== null && turno !== null && llegada <= turno + TOLERANCIA_PUNTUALIDAD_MIN * 60000;
    });
    const pendientesFallidosPorRepartidor = contarFallidosPendientesPorRepartidor();
    const alertas = filas.filter(f => {
      const estado = calcularEstadoChofer(f);
      return estado.color === "rojo" || (pendientesFallidosPorRepartidor.get(claveRepartidorAsistencia(f)) || 0) > 0;
    });

    const tarjetas = [
      { label: "Asistencia confirmada", valor: _fmtPct(_pct(asistenciaSi, total)) },
      { label: "Llegada a tiempo", valor: _fmtPct(_pct(aTiempo.length, conLlegada.length)) },
      { label: "Pallet retirado", valor: _fmtPct(_pct(palletRetiradoSi, total)) },
      { label: "Alertas activas", valor: String(alertas.length) },
    ];
    document.getElementById("kpis-vivo").innerHTML = tarjetas.map(t => `
      <div class="kpi-ruta"><div class="label">${t.label}</div><div class="valor">${t.valor}</div></div>
    `).join("");

    const zonasMap = new Map();
    filas.forEach(f => {
      const zona = f.zona || "Sin zona";
      if(!zonasMap.has(zona)) zonasMap.set(zona, { total: 0, confirmados: 0, palletListo: 0, enRuta: 0, choferes: [] });
      const z = zonasMap.get(zona);
      z.total++;
      if(f.asiste_soporte) z.confirmados++;
      if(f.pallet_listo_deposito) z.palletListo++;
      if(f.pallet_retirado_deposito) z.enRuta++;
      z.choferes.push(f);
    });
    const zonasEl = document.getElementById("zonas-vivo");
    if(!zonasMap.size){
      zonasEl.innerHTML = `<p class="sin-datos">Sin repartidores cargados para hoy.</p>`;
    } else {
      zonasEl.innerHTML = [...zonasMap.entries()].map(([zona, z]) => `
        <div class="zona-card-vivo">
          <h4>${zona}</h4>
          <div class="zona-fila-vivo"><span>Confirmados</span><b>${z.confirmados} / ${z.total}</b></div>
          <div class="zona-fila-vivo"><span>Pallet listo</span><b>${z.palletListo}</b></div>
          <div class="zona-fila-vivo"><span>En ruta</span><b>${z.enRuta}</b></div>
          <div class="zona-choferes-vivo">
            ${z.choferes.map(f => {
              const estado = calcularEstadoChofer(f);
              return `
                <div class="zona-chofer-fila">
                  <div class="zc-fila-arriba">
                    <span class="estado-icono-fila chico ${estado.color}"><i data-lucide="${estado.icono}"></i></span>
                    <span class="zc-nombre">${tituloNombre(f.nombre) || "(sin nombre)"}</span>
                    <span class="zc-dato">${f.tipo_vehiculo || "—"}</span>
                    <span class="zc-dato">${f.turno ? f.turno.slice(0,5) : "—"}</span>
                  </div>
                  <div class="zc-estado-texto ${estado.color}">${estado.label}</div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `).join("");
    }

    const alertasEl = document.getElementById("alertas-vivo");
    if(!alertas.length){
      alertasEl.innerHTML = `<p class="sin-datos">Sin alertas activas por ahora.</p>`;
    } else {
      alertasEl.innerHTML = alertas.map(f => {
        const estado = calcularEstadoChofer(f);
        const nivel = estado.color === "rojo" ? "rojo" : "amarillo";
        const icono = nivel === "rojo" ? "alert-triangle" : "clock";
        return `
          <div class="alerta-item-vivo ${nivel}">
            <i data-lucide="${icono}"></i>
            <span class="nombre-chofer">${tituloNombre(f.nombre) || "(sin nombre)"}</span>&nbsp;— ${estado.label}
          </div>
        `;
      }).join("");
    }
    lucide.createIcons();
  }

  // "Agregar repartidor" en Asistencia: SOLO elige un repartidor que ya
  // existe en el roster (Configuración → Repartidores) — no se puede
  // tipear un nombre nuevo acá. Si el repartidor que necesitás no está en
  // el roster, primero hay que darlo de alta ahí (pedido 2026-11-17: el
  // roster es la única fuente de verdad, nunca un alta manual suelta).
  document.getElementById("btn-agregar-chofer").addEventListener("click", async ()=>{
    const { data: roster, error: errorRoster } = await sb.from("choferes_roster")
      .select("id,nombre,tipo_vehiculo,turno,zona,localidades,lightdata_id")
      .eq("activo", true)
      .order("nombre");
    if(errorRoster){ console.error("Error cargando choferes_roster:", errorRoster); await mostrarAviso("No se pudo cargar el roster."); return; }
    if(!roster || !roster.length){ await mostrarAviso("No hay repartidores activos en el roster. Dalos de alta primero en Configuración → Repartidores."); return; }

    const yaCargados = new Set(stateAsistencia.filas.map(f => f.nombre));
    const opciones = roster.filter(r => !yaCargados.has(r.nombre)).map(r => ({ valor: String(r.id), texto: r.nombre }));
    if(!opciones.length){ await mostrarAviso("Todos los repartidores activos del roster ya están cargados para esta fecha."); return; }

    abrirModalAbm("Agregar repartidor", [
      { clave: "chofer_roster_id", label: "Repartidor (del roster)", tipo: "select", opciones },
    ], {}, async (vals)=>{
      if(!vals.chofer_roster_id){ await mostrarAviso("Elegí un repartidor."); return false; }
      const r = roster.find(x => String(x.id) === vals.chofer_roster_id);
      const fecha = fechaAsistenciaActual();
      const { data, error } = await sb.from("asistencia_diaria")
        .insert({ fecha, nombre: r.nombre, tipo_vehiculo: r.tipo_vehiculo, turno: r.turno, zona: r.zona, localidades: r.localidades, lightdata_id: r.lightdata_id })
        .select()
        .single();
      if(error){
        console.error("Error agregando repartidor:", error);
        await mostrarAviso("No se pudo agregar (¿ya existe ese repartidor para esta fecha y turno vacío?).");
        return false;
      }
      stateAsistencia.filas.push(data);
      renderAsistencia();
    });
  });
