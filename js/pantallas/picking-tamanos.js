// Picking Tamaños: lectura de pistola GRA-/MED- contra envíos programados hoy.
// Viene de index.html (Etapa 3a de migración a ES Modules, 2026-11-24).
import { sb } from "../core/supabase.js";
import { fechaART } from "../core/fechas.js";

  // ===================== Picking Tamaños =====================
  // Puerto de la lógica de Picking.txt/Codigo.txt (planilla vieja): la
  // pistola manda un string con prefijo GRA-/MED- (Grande/Mediano — el
  // "Pequeño" nunca se escanea, es el default implícito de un envío que
  // nunca pasó por acá) seguido de un JSON con el id/tracking/did del
  // paquete. `picking_tamanos.id_normalizado` tiene un unique index parcial
  // (excluye "Revisar_Manual") para poder hacer upsert — si el mismo
  // paquete se escanea dos veces, el último escaneo pisa al anterior, igual
  // que el "CORREGIDO" de la planilla vieja.
  function detectarTamanoEscaneo(raw){
    if(raw.startsWith("GRA-")) return "Grande";
    if(raw.startsWith("MED-")) return "Mediano";
    return null;
  }
  function extraerIdNormalizadoEscaneo(raw){
    const matchDid = raw.match(/(?:^|[^a-zA-Z0-9_])"?did"?\s*:\s*"([^"{}\n\r]+)"/i);
    const matchTracking = raw.match(/(?:^|[^a-zA-Z0-9_])"?tracking_number"?\s*:\s*"([^"{}\n\r]+)"/i);
    const matchId = raw.match(/(?:^|[^a-zA-Z0-9_])"?[iï]d"?\s*:\s*"([^"{}\n\r]+)"/i);
    if(matchDid) return { id: matchDid[1], tipo: "Directo" };
    if(matchTracking) return { id: matchTracking[1], tipo: "Mercadolibre" };
    if(matchId) return { id: matchId[1], tipo: "Mercadolibre" };
    return { id: "Revisar_Manual", tipo: "Desconocido" };
  }

  async function registrarEscaneoPicking(raw){
    const tamano = detectarTamanoEscaneo(raw);
    if(!tamano) return { ok: false, msg: `Tamaño no detectado (${raw.slice(0, 15)}…)` };

    const { id: idNormalizado, tipo: tipoEnvio } = extraerIdNormalizadoEscaneo(raw);

    const filaEscaneo = { escaneo_crudo: raw, tamano, id_normalizado: idNormalizado, tipo_envio: tipoEnvio, creado_en: new Date().toISOString() };

    // Dedup a mano (no `upsert({onConflict})`): el unique index de
    // id_normalizado es PARCIAL (excluye "Revisar_Manual", que se repite
    // legítimamente) — Postgres no puede resolver "ON CONFLICT (columna)"
    // contra un índice parcial sin repetir su condición ahí mismo, y
    // supabase-js no tiene forma de mandar esa condición extra. Sin esto,
    // el upsert fallaba del lado del servidor para cualquier escaneo real
    // (bug reportado 2026-11-22: "No se pudo guardar" en todo intento).
    let error, esCorreccion = false;
    if(idNormalizado !== "Revisar_Manual"){
      const { data: existente, error: errBusqueda } = await sb.from("picking_tamanos")
        .select("id").eq("id_normalizado", idNormalizado).maybeSingle();
      if(errBusqueda){ console.error("Error buscando escaneo existente:", errBusqueda); return { ok: false, msg: "No se pudo guardar." }; }
      esCorreccion = !!existente;
      ({ error } = existente
        ? await sb.from("picking_tamanos").update(filaEscaneo).eq("id", existente.id)
        : await sb.from("picking_tamanos").insert(filaEscaneo));
    } else {
      ({ error } = await sb.from("picking_tamanos").insert(filaEscaneo));
    }
    if(error){ console.error("Error guardando escaneo de picking:", error); return { ok: false, msg: "No se pudo guardar." }; }

    // El cruce con Envíos (punto 5) ya NO se hace desde acá — lo garantiza
    // un trigger de Postgres en ambas direcciones (ver migración
    // 2026-11-23_sincronizar_tamano_envios.sql), así cubre también el caso
    // en que el envío todavía no existía al momento de escanear.

    // Mismo wording que registrarEscaneoDesdePanel() de la planilla vieja
    // (Codigo.txt): "NUEVO: ..." o "🔄 CORREGIDO a ...". Cada escaneo físico
    // de la pistola tiene que verse como SU PROPIA línea en el historial —
    // es un log de actividad, no una vista del estado actual de la tabla
    // (ver Lector.html: nunca dedupeaba ni reemplazaba líneas anteriores).
    return esCorreccion
      ? { ok: true, msg: `🔄 CORREGIDO a ${tamano} — ${idNormalizado}` }
      : { ok: true, msg: `NUEVO: ${tamano} — ${idNormalizado}` };
  }

  // Grilla principal (pedido 2026-11-23): ya no es una sola pantalla de
  // escaneo — ahora es como cualquier otra pantalla del sistema (buscador +
  // filtro de fecha + botón de acción), con una grilla de los escaneos del
  // filtro elegido. Por default siempre arranca en "hoy" cada vez que se
  // entra a la pantalla (el escaneo en vivo pasa a un modal aparte).
  export const statePickingTamanos = { busqueda: "", fecha: fechaART(0) };

  function construirQueryPickingTamanos(){
    const desde = statePickingTamanos.fecha + "T00:00:00";
    const fechaSiguiente = new Date(statePickingTamanos.fecha + "T00:00:00");
    fechaSiguiente.setDate(fechaSiguiente.getDate() + 1);
    const hasta = fechaSiguiente.toISOString().slice(0, 10) + "T00:00:00";
    let q = sb.from("picking_tamanos").select("*")
      .gte("creado_en", desde).lt("creado_en", hasta)
      .order("creado_en", { ascending: false });
    if(statePickingTamanos.busqueda){
      const b = statePickingTamanos.busqueda.replace(/[%,]/g, "");
      q = q.or(`id_normalizado.ilike.%${b}%,escaneo_crudo.ilike.%${b}%`);
    }
    return q;
  }

  export async function cargarPickingTamanosGrid(){
    const tbody = document.getElementById("tabla-picking-tamanos");
    const { data, error } = await construirQueryPickingTamanos();
    if(error){
      console.error("Error cargando picking_tamanos:", error);
      tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Error cargando los datos.</td></tr>`;
      return;
    }
    tbody.innerHTML = (data && data.length)
      ? data.map(f => `
        <tr>
          <td>${new Date(f.creado_en).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</td>
          <td>${f.tamano}</td>
          <td>${f.id_normalizado}</td>
          <td>${f.tipo_envio}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="4" class="sin-datos">Sin escaneos para este filtro.</td></tr>`;
  }

  document.getElementById("picking-tamanos-fecha").value = statePickingTamanos.fecha;
  document.getElementById("picking-tamanos-fecha").addEventListener("change", (e)=>{
    statePickingTamanos.fecha = e.target.value || fechaART(0);
    cargarPickingTamanosGrid();
  });
  let debouncePickingTamanos = null;
  document.getElementById("buscar-picking-tamanos").addEventListener("input", (e)=>{
    statePickingTamanos.busqueda = e.target.value.trim();
    clearTimeout(debouncePickingTamanos);
    debouncePickingTamanos = setTimeout(cargarPickingTamanosGrid, 350);
  });

  // Modal de escaneo: sesión de escaneo en vivo (puerto de Lector.html —
  // ver más abajo). El log de acciones del modal arranca vacío cada vez que
  // se abre (no persiste entre aperturas, igual que la planilla vieja); la
  // grilla de atrás sí persiste y se refresca al cerrar el modal.
  const modalEscaneoPicking = document.getElementById("modal-escaneo-picking");
  const inputPicking = document.getElementById("input-picking-tamanos");
  function abrirModalEscaneoPicking(){
    document.getElementById("picking-tamanos-historial").innerHTML = "";
    modalEscaneoPicking.hidden = false;
    inputPicking.focus();
  }
  function cerrarModalEscaneoPicking(){
    modalEscaneoPicking.hidden = true;
    cargarPickingTamanosGrid();
  }
  document.getElementById("btn-abrir-escaneo-picking").addEventListener("click", abrirModalEscaneoPicking);
  document.getElementById("modal-escaneo-picking-cerrar").addEventListener("click", cerrarModalEscaneoPicking);
  modalEscaneoPicking.addEventListener("click", (e)=>{
    if(e.target.id === "modal-escaneo-picking") cerrarModalEscaneoPicking();
  });
  // Foco pegajoso (puerto de Lector.html): la pistola siempre tiene que
  // encontrar el cursor en esta caja, sin que el operario tenga que
  // clickearla — pero solo mientras el modal esté abierto.
  inputPicking.addEventListener("blur", ()=>{
    setTimeout(()=>{ if(!modalEscaneoPicking.hidden) inputPicking.focus(); }, 10);
  });
  inputPicking.addEventListener("keypress", async (e)=>{
    if(e.key !== "Enter") return;
    e.preventDefault();
    const valor = inputPicking.value.trim();
    inputPicking.value = "";
    if(!valor) return;
    const cont = document.getElementById("picking-tamanos-historial");
    // Pedido 2026-11-23: mantener EXACTAMENTE la misma dinámica de
    // Lector.html — cada escaneo agrega su propia línea (log de
    // actividad, confirma que la pistola disparó), nunca se reemplaza ni
    // se dedupea visualmente aunque sea el mismo paquete reescaneado.
    const item = document.createElement("div");
    item.className = "picking-item procesando";
    item.textContent = "⏳ Procesando…";
    cont.prepend(item);
    const resultado = await registrarEscaneoPicking(valor);
    item.className = "picking-item " + (resultado.ok ? "ok" : "error");
    item.textContent = (resultado.ok ? "✅ " : "❌ ") + resultado.msg;
    if(resultado.ok && statePickingTamanos.fecha === fechaART(0)) cargarPickingTamanosGrid();
  });
