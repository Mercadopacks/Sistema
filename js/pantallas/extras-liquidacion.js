// Extras y Descuentos (Clientes/Repartidores) — sacado de index.html en la
// Etapa 6 de migración a ES Modules (2026-11-25).
import { sb } from "../core/supabase.js";
import { formatearFecha, formatearMoneda, parsearMoneda } from "../core/formato.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { crearComboGenerico, agregarOpcionesCombo } from "../ui/combos.js";
import { catalogos, nombreCliente } from "../core/catalogos.js";
import { fechaART, lunesDeSemana } from "../core/fechas.js";
import { abmTiposExtra } from "../admin/abm-tipos-extra.js";
  // ===================== Extras y Descuentos (Clientes/Repartidores) =====================
  // Puerto conceptual de la columna "detalle de descuentos" que armaba a
  // mano la planilla vieja (Generar liquidacion.txt: rangoDetalleDescuentos
  // S6:S32) — acá queda como su propio registro estructurado por fila en
  // vez de celdas sueltas, para poder filtrar/sumar por entidad y período.
  // Pedido 2026-11-23 (3ra vuelta): 2 PANTALLAS separadas de verdad (no un
  // selector adentro de una sola) — son 2 sectores distintos los que
  // cargan extras de Clientes vs. Repartidores y no pueden entrar al mismo
  // panel (separadas también en VISTAS_DISPONIBLES/permisos, así se le
  // puede dar acceso a una sin la otra). El modal de carga SÍ es
  // compartido (un solo overlay) — qué tabla usa y cómo refresca la
  // grilla al guardar se decide por `extraLiquidacionModoActivo`, fijado
  // por la instancia (Clientes o Repartidores) que lo abrió.
  let repartidoresDisponibles = []; // [{id, nombre}]

  async function cargarClientesDisponibles(){
    if(catalogos.clientes.length) return;
    const { data, error } = await sb.from("lightdata_clientes").select("did,codigo,nombre_fantasia").eq("habilitado", true).order("nombre_fantasia");
    if(error){ console.error("Error cargando lightdata_clientes:", error); return; }
    catalogos.clientes = data || [];
  }
  async function cargarRepartidoresDisponibles(){
    if(repartidoresDisponibles.length) return;
    const { data, error } = await sb.from("choferes_roster").select("id,nombre").eq("activo", true).order("nombre");
    if(error){ console.error("Error cargando choferes_roster:", error); return; }
    repartidoresDisponibles = data || [];
  }
  function tablaExtrasPara(modo){ return modo === "cliente" ? "liquidacion_extras_clientes" : "liquidacion_extras_repartidores"; }
  function campoEntidadPara(modo){ return modo === "cliente" ? "did_cliente" : "chofer_id"; }
  function selectExtrasPara(modo){
    return modo === "cliente"
      ? "*,lightdata_clientes(nombre_fantasia,codigo),parametros_tipos_extra(nombre,requiere_envio,signo),envios(tracking,id_venta_ml)"
      : "*,choferes_roster(nombre),parametros_tipos_extra(nombre,requiere_envio,signo),envios(tracking,id_venta_ml)";
  }
  function entidadDeExtra(f, modo){
    const c = modo === "cliente" ? f.lightdata_clientes : f.choferes_roster;
    return Array.isArray(c) ? c[0] : c;
  }
  function tipoDeExtra(f){ const t = f.parametros_tipos_extra; return Array.isArray(t) ? t[0] : t; }
  function envioDeExtra(f){ const e = f.envios; return Array.isArray(e) ? e[0] : e; }
  function labelEntidadExtra(f, modo){
    const e = entidadDeExtra(f, modo);
    if(!e) return "—";
    return modo === "cliente" ? nombreCliente(e) : e.nombre;
  }

  // Fábrica: una instancia por pantalla (Clientes/Repartidores), cada una
  // con su propio estado/filtros/grilla — comparten el modal de carga de
  // abajo.
  // Combos del modal compartido (Cliente/Repartidor/Signo): se arman UNA
  // sola vez en total (no una vez por pantalla) — los <li> tienen que
  // existir ANTES de crearComboGenerico, ver la regla de siempre.
  let modalExtraLiquidacionWireado = false;
  async function asegurarCombosModalExtra(){
    if(modalExtraLiquidacionWireado) return;
    modalExtraLiquidacionWireado = true;
    await Promise.all([cargarClientesDisponibles(), cargarRepartidoresDisponibles()]);
    agregarOpcionesCombo("combo-extra-liquidacion-cliente", catalogos.clientes.map(c => ({ valor: c.did, texto: nombreCliente(c) })));
    crearComboGenerico("combo-extra-liquidacion-cliente", (valor)=>{
      document.getElementById("combo-extra-liquidacion-cliente").dataset.valorActual = valor;
    });
    agregarOpcionesCombo("combo-extra-liquidacion-repartidor", repartidoresDisponibles.map(r => ({ valor: r.id, texto: r.nombre })));
    crearComboGenerico("combo-extra-liquidacion-repartidor", (valor)=>{
      document.getElementById("combo-extra-liquidacion-repartidor").dataset.valorActual = valor;
    });
    crearComboGenerico("combo-extra-liquidacion-signo", (valor)=>{
      document.getElementById("combo-extra-liquidacion-signo").dataset.valorActual = valor;
      repoblarComboConceptoExtra();
    });
  }

  function crearModuloExtrasLiquidacion(modo, sufijo){
    // Pedido 2026-11-24: el rango por default debe ser la semana
    // CALENDARIO en curso (lunes a hoy), no una ventana móvil de 7 días
    // (que antes arrancaba un día de la semana anterior, ej. "18 a hoy").
    const state = { busqueda: "", desde: lunesDeSemana(fechaART(0)), hasta: fechaART(0), filas: [] };
    let cargado = false;

    async function inicializar(){
      if(cargado) return;
      cargado = true;
      await Promise.all([asegurarCombosModalExtra(), abmTiposExtra.cargar()]);

      document.getElementById(`extras-liquidacion-desde-${sufijo}`).value = state.desde;
      document.getElementById(`extras-liquidacion-hasta-${sufijo}`).value = state.hasta;
      document.getElementById(`extras-liquidacion-desde-${sufijo}`).addEventListener("change", (e)=>{ state.desde = e.target.value || lunesDeSemana(fechaART(0)); cargar(); });
      document.getElementById(`extras-liquidacion-hasta-${sufijo}`).addEventListener("change", (e)=>{ state.hasta = e.target.value || fechaART(0); cargar(); });
      document.getElementById(`buscar-extras-liquidacion-${sufijo}`).addEventListener("input", (e)=>{ state.busqueda = e.target.value.toLowerCase(); render(); });
      document.getElementById(`btn-agregar-extra-liquidacion-${sufijo}`).addEventListener("click", ()=> abrirModal());
      document.getElementById(`tabla-extras-liquidacion-${sufijo}`).addEventListener("click", (e)=>{
        const btnEditar = e.target.closest(".btn-icono-chico.editar");
        const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
        if(btnEditar) abrirModal(Number(btnEditar.dataset.id));
        if(btnBorrar) borrar(Number(btnBorrar.dataset.id));
      });
    }

    async function cargar(){
      const { data, error } = await sb.from(tablaExtrasPara(modo)).select(selectExtrasPara(modo))
        .gte("fecha", state.desde).lte("fecha", state.hasta).order("fecha", { ascending: false });
      if(error){ console.error(`Error cargando ${tablaExtrasPara(modo)}:`, error); return; }
      state.filas = data || [];
      render();
    }

    function render(){
      const b = state.busqueda;
      let filas = state.filas;
      if(b) filas = filas.filter(f => {
        const tipo = tipoDeExtra(f);
        return labelEntidadExtra(f, modo).toLowerCase().includes(b)
          || (tipo && tipo.nombre.toLowerCase().includes(b))
          || (f.observaciones || "").toLowerCase().includes(b)
          || (f.direccion || "").toLowerCase().includes(b);
      });
      const tbody = document.getElementById(`tabla-extras-liquidacion-${sufijo}`);
      if(!filas.length){
        tbody.innerHTML = `<tr><td colspan="8" class="sin-datos">Sin extras/descuentos para este filtro.</td></tr>`;
        return;
      }
      tbody.innerHTML = filas.map(f => {
        const tipo = tipoDeExtra(f);
        const envio = envioDeExtra(f);
        const signoLabel = tipo ? (tipo.signo === "descuento" ? "Descuento" : "Adicional") : "—";
        return `
        <tr data-id="${f.id}">
          <td>${formatearFecha(f.fecha)}</td>
          <td>${labelEntidadExtra(f, modo)}</td>
          <td>${signoLabel}</td>
          <td>${tipo ? tipo.nombre : "—"}</td>
          <td>${envio ? (envio.tracking || envio.id_venta_ml) : (f.direccion || "—")}</td>
          <td>${formatearMoneda(f.importe)}</td>
          <td class="celda-texto-solo">${f.observaciones || "—"}</td>
          <td class="col-opciones">
            <span class="opciones-fila">
              <button type="button" class="btn-icono-chico editar" data-id="${f.id}" title="Editar"><i data-lucide="pencil"></i></button>
              <button type="button" class="btn-icono-chico borrar" data-id="${f.id}" title="Borrar"><i data-lucide="trash-2"></i></button>
            </span>
          </td>
        </tr>
      `;
      }).join("");
      lucide.createIcons();
    }

    function abrirModal(id){
      extraLiquidacionModoActivo = modo;
      const fila = id ? state.filas.find(f => f.id === id) : null;
      extraLiquidacionOnGuardado = (filaGuardada)=>{
        const idx = state.filas.findIndex(f => f.id === filaGuardada.id);
        if(idx !== -1) state.filas[idx] = filaGuardada; else state.filas.unshift(filaGuardada);
        render();
      };
      abrirModalExtraLiquidacionCompartido(modo, fila);
    }

    async function borrar(id){
      if(!(await mostrarConfirmacion("¿Borrar este registro? No se puede deshacer."))) return;
      const { error } = await sb.from(tablaExtrasPara(modo)).delete().eq("id", id);
      if(error){ console.error(error); await mostrarAviso("No se pudo borrar."); return; }
      state.filas = state.filas.filter(f => f.id !== id);
      render();
    }

    return { inicializar, cargar };
  }

  export const moduloExtrasClientes = crearModuloExtrasLiquidacion("cliente", "clientes");
  export const moduloExtrasRepartidores = crearModuloExtrasLiquidacion("repartidor", "repartidores");

  // ----- Modal compartido de carga/edición -----
  let extraLiquidacionModoActivo = "cliente";
  let extraLiquidacionEditandoId = null;
  let extraLiquidacionEnvioSeleccionado = null; // { id_interno, tracking, id_venta_ml }
  let extraLiquidacionOnGuardado = null; // callback(filaGuardada) de la pantalla que abrió el modal

  // Repuebla el combo de Concepto según Signo elegido + modo activo
  // (Cliente/Repartidor). BUG REAL 2026-11-24: antes esto solo vaciaba el
  // <ul> y volvía a llamar crearComboGenerico() sobre el MISMO <button>
  // persistente — cada llamada agrega un listener de click nuevo sobre
  // ese botón sin sacar los anteriores, así que después de 2 cambios de
  // Signo el botón tenía 2 listeners: el primero abre la lista, el
  // segundo la vuelve a cerrar en la misma tacada de clicks (paridad
  // par = "no abre nada"; con 3 listeners sí abre, de ahí que "clickeando
  // Tipo de nuevo" lo arreglara). Fix: reconstruir el contenedor
  // (`.combo-filtro` entero, botón incluido) con innerHTML en cada
  // cambio, igual que el combo de período de Liquidación Clientes — los
  // nodos viejos (con sus listeners) quedan descartados en vez de
  // reutilizados.
  function repoblarComboConceptoExtra(){
    const cont = document.getElementById("combo-extra-liquidacion-tipo");
    const signo = document.getElementById("combo-extra-liquidacion-signo").dataset.valorActual;
    if(!signo){
      cont.innerHTML = `<button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false" disabled>Elegí primero el tipo…</button><ul class="combo-filtro-lista" role="listbox" hidden></ul>`;
      cont.dataset.valorActual = "";
      return;
    }
    const opciones = (abmTiposExtra.obtenerActivosConId(extraLiquidacionModoActivo) || []).filter(t => t.signo === signo);
    cont.innerHTML = `
      <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Elegir…</button>
      <ul class="combo-filtro-lista" role="listbox" hidden>
        ${opciones.map(o => `<li data-valor="${o.valor}">${o.texto}</li>`).join("")}
      </ul>
    `;
    cont.dataset.valorActual = "";
    crearComboGenerico("combo-extra-liquidacion-tipo", (valor)=>{
      document.getElementById("combo-extra-liquidacion-tipo").dataset.valorActual = valor;
      actualizarCamposSegunTipoExtra();
    });
  }

  function tipoExtraSeleccionado(){
    const valor = document.getElementById("combo-extra-liquidacion-tipo").dataset.valorActual;
    return (abmTiposExtra.obtenerActivosConId(extraLiquidacionModoActivo) || []).find(t => String(t.valor) === String(valor));
  }

  function actualizarCamposSegunTipoExtra(){
    const tipo = tipoExtraSeleccionado();
    // Pedido 2026-11-24: Dirección ya NO es "lo que se muestra cuando no
    // pide envío" — es su propio flag (requiere_direccion), para que un
    // concepto que no es envío NI flete (ej. "Adelanto" de un repartidor)
    // no muestre ningún campo de más.
    document.getElementById("extra-liquidacion-campo-envio").hidden = !(tipo && tipo.requiereEnvio);
    document.getElementById("extra-liquidacion-campo-direccion").hidden = !(tipo && tipo.requiereDireccion);
  }

  async function buscarEnvioParaExtra(texto){
    const cont = document.getElementById("extra-liquidacion-envio-resultado");
    if(!texto){ return; }
    const b = texto.replace(/[%,]/g, "");
    let q = sb.from("envios").select("id_interno,tracking,id_venta_ml,fecha_mercadopacks,cadete")
      .or(`tracking.ilike.%${b}%,id_venta_ml.ilike.%${b}%`)
      .order("fecha_mercadopacks", { ascending: false })
      .limit(8);
    if(extraLiquidacionModoActivo === "cliente"){
      const didCliente = Number(document.getElementById("combo-extra-liquidacion-cliente").dataset.valorActual);
      if(!didCliente){ cont.innerHTML = `<p class="sin-datos">Elegí primero el cliente.</p>`; return; }
      q = q.eq("did_cliente", didCliente);
    }
    const { data, error } = await q;
    if(error){ console.error("Error buscando envíos:", error); cont.innerHTML = `<p class="sin-datos">Error buscando.</p>`; return; }
    if(!data || !data.length){ cont.innerHTML = `<p class="sin-datos">Sin resultados.</p>`; return; }
    cont.innerHTML = `<div class="lista-multiselect" style="max-height:160px;">${data.map(e => `
      <div class="picking-item" style="cursor:pointer;" data-id="${e.id_interno}" data-tracking="${e.tracking || ""}" data-venta="${e.id_venta_ml || ""}">
        ${e.tracking || "—"} ${e.id_venta_ml ? `· venta ${e.id_venta_ml}` : ""} <span class="texto-muted">(${formatearFecha(e.fecha_mercadopacks)})</span>
      </div>
    `).join("")}</div>`;
  }

  function seleccionarEnvioParaExtra(idInterno, tracking, idVenta){
    extraLiquidacionEnvioSeleccionado = { id_interno: idInterno, tracking, id_venta_ml: idVenta };
    document.getElementById("extra-liquidacion-envio-resultado").innerHTML = `
      <div class="picking-item ok">Elegido: ${tracking || idVenta || idInterno}
        <button type="button" class="btn-icono-chico" id="btn-quitar-envio-extra" title="Elegir otro"><i data-lucide="x"></i></button>
      </div>`;
    lucide.createIcons();
  }

  function abrirModalExtraLiquidacionCompartido(modo, fila){
    extraLiquidacionEditandoId = fila ? fila.id : null;
    extraLiquidacionEnvioSeleccionado = null;
    const esCliente = modo === "cliente";

    document.getElementById("modal-extra-liquidacion-titulo").textContent = fila ? "Editar extra/descuento" : "Agregar extra/descuento";
    document.getElementById("extra-liquidacion-fecha").value = fila ? fila.fecha : fechaART(0);
    document.getElementById("extra-liquidacion-direccion").value = fila ? (fila.direccion || "") : "";
    document.getElementById("extra-liquidacion-observaciones").value = fila ? (fila.observaciones || "") : "";
    document.getElementById("extra-liquidacion-importe").value = formatearMoneda(fila ? fila.importe : null);
    document.getElementById("extra-liquidacion-envio-resultado").innerHTML = "";
    document.getElementById("extra-liquidacion-buscar-envio").value = "";

    document.getElementById("extra-liquidacion-campo-cliente").hidden = !esCliente;
    document.getElementById("extra-liquidacion-campo-repartidor").hidden = esCliente;

    if(esCliente){
      const comboCliente = document.getElementById("combo-extra-liquidacion-cliente");
      const clienteActual = fila ? fila.did_cliente : "";
      comboCliente.dataset.valorActual = clienteActual;
      const cliObj = catalogos.clientes.find(c => String(c.did) === String(clienteActual));
      comboCliente.querySelector(".combo-filtro-btn").textContent = cliObj ? nombreCliente(cliObj) : "Elegir…";
      comboCliente.querySelectorAll("li").forEach(li => li.setAttribute("aria-selected", String(li.dataset.valor === String(clienteActual))));
    } else {
      const comboRep = document.getElementById("combo-extra-liquidacion-repartidor");
      const repActual = fila ? fila.chofer_id : "";
      comboRep.dataset.valorActual = repActual;
      const repObj = repartidoresDisponibles.find(r => String(r.id) === String(repActual));
      comboRep.querySelector(".combo-filtro-btn").textContent = repObj ? repObj.nombre : "Elegir…";
      comboRep.querySelectorAll("li").forEach(li => li.setAttribute("aria-selected", String(li.dataset.valor === String(repActual))));
    }

    const tipoFila = fila ? tipoDeExtra(fila) : null;
    const signoActual = tipoFila ? tipoFila.signo : "";
    const comboSigno = document.getElementById("combo-extra-liquidacion-signo");
    comboSigno.dataset.valorActual = signoActual;
    comboSigno.querySelector(".combo-filtro-btn").textContent = signoActual === "descuento" ? "Descuento (-)" : (signoActual === "adicional" ? "Adicional (+)" : "Elegir…");
    comboSigno.querySelectorAll("li").forEach(li => li.setAttribute("aria-selected", String(li.dataset.valor === signoActual)));
    repoblarComboConceptoExtra();

    const comboTipo = document.getElementById("combo-extra-liquidacion-tipo");
    const tipoActual = fila ? fila.tipo_extra_id : "";
    comboTipo.dataset.valorActual = tipoActual;
    const tipoObj = (abmTiposExtra.obtenerActivosConId(modo) || []).find(t => String(t.valor) === String(tipoActual));
    if(tipoObj) comboTipo.querySelector(".combo-filtro-btn").textContent = tipoObj.texto;
    comboTipo.querySelectorAll("li").forEach(li => li.setAttribute("aria-selected", String(li.dataset.valor === String(tipoActual))));

    actualizarCamposSegunTipoExtra();
    if(fila && fila.envios){
      const envio = envioDeExtra(fila);
      if(envio) seleccionarEnvioParaExtra(fila.envio_id_interno, envio.tracking, envio.id_venta_ml);
    }

    document.getElementById("modal-extra-liquidacion").hidden = false;
  }

  document.getElementById("extra-liquidacion-buscar-envio").addEventListener("keypress", (e)=>{
    if(e.key !== "Enter") return;
    e.preventDefault();
    buscarEnvioParaExtra(e.target.value.trim());
  });
  document.getElementById("extra-liquidacion-envio-resultado").addEventListener("click", (e)=>{
    const item = e.target.closest("[data-id]");
    if(item){
      seleccionarEnvioParaExtra(item.dataset.id, item.dataset.tracking, item.dataset.venta);
      return;
    }
    if(e.target.closest("#btn-quitar-envio-extra")){
      extraLiquidacionEnvioSeleccionado = null;
      document.getElementById("extra-liquidacion-envio-resultado").innerHTML = "";
      document.getElementById("extra-liquidacion-buscar-envio").value = "";
    }
  });
  document.getElementById("modal-extra-liquidacion").addEventListener("focusout", (e)=>{
    if(e.target.id === "extra-liquidacion-importe") e.target.value = formatearMoneda(parsearMoneda(e.target.value));
  });
  document.getElementById("modal-extra-liquidacion-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-extra-liquidacion").hidden = true;
  });
  document.getElementById("modal-extra-liquidacion").addEventListener("click", (e)=>{
    if(e.target.id === "modal-extra-liquidacion") document.getElementById("modal-extra-liquidacion").hidden = true;
  });
  document.getElementById("modal-extra-liquidacion-guardar").addEventListener("click", async ()=>{
    const modo = extraLiquidacionModoActivo;
    const esCliente = modo === "cliente";
    const entidadId = esCliente
      ? Number(document.getElementById("combo-extra-liquidacion-cliente").dataset.valorActual) || null
      : Number(document.getElementById("combo-extra-liquidacion-repartidor").dataset.valorActual) || null;
    const tipoId = Number(document.getElementById("combo-extra-liquidacion-tipo").dataset.valorActual) || null;
    const fecha = document.getElementById("extra-liquidacion-fecha").value;
    const importe = parsearMoneda(document.getElementById("extra-liquidacion-importe").value);
    const tipo = tipoExtraSeleccionado();

    if(!entidadId || !tipoId || !fecha || importe == null){
      await mostrarAviso(`Completá fecha, ${esCliente ? "cliente" : "repartidor"}, tipo e importe.`);
      return;
    }
    if(tipo && tipo.requiereEnvio && !extraLiquidacionEnvioSeleccionado){
      await mostrarAviso("Este tipo requiere elegir un envío.");
      return;
    }

    const payload = {
      fecha, [campoEntidadPara(modo)]: entidadId, tipo_extra_id: tipoId, importe,
      envio_id_interno: tipo && tipo.requiereEnvio ? extraLiquidacionEnvioSeleccionado.id_interno : null,
      direccion: tipo && tipo.requiereDireccion ? (document.getElementById("extra-liquidacion-direccion").value.trim() || null) : null,
      observaciones: document.getElementById("extra-liquidacion-observaciones").value.trim() || null,
    };

    const btn = document.getElementById("modal-extra-liquidacion-guardar");
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      const resultado = extraLiquidacionEditandoId
        ? await sb.from(tablaExtrasPara(modo)).update(payload).eq("id", extraLiquidacionEditandoId).select(selectExtrasPara(modo)).single()
        : await sb.from(tablaExtrasPara(modo)).insert(payload).select(selectExtrasPara(modo)).single();
      if(resultado.error){ console.error("Error guardando extra de liquidación:", resultado.error); await mostrarAviso("No se pudo guardar."); return; }
      if(extraLiquidacionOnGuardado) extraLiquidacionOnGuardado(resultado.data);
      document.getElementById("modal-extra-liquidacion").hidden = true;
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
