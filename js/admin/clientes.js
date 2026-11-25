// Configuración > Clientes: listado de clientes de Lightdata (solo lectura),
// detalle con cuentas asociadas, Dirección y días de colecta (clientes_colectas)
// y Precios por cliente (precios_cliente / _envio / _flete).
// Viene de index.html (Etapa 5a de migración a ES Modules, 2026-11-25).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { tituloTexto, formatearMoneda, parsearMoneda } from "../core/formato.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { crearComboGenerico, crearMultiSelectGenerico } from "../ui/combos.js";
import { abmCordones, abmTamanosPaquete } from "./abm-simple.js";
import { abmTurnos } from "./abm-turnos.js";
import { nombreCliente } from "../core/catalogos.js";

  // ----- Clientes (pedido 2026-11-20) -----
  // Solo lectura: los datos vienen de Lightdata (sincronizados por
  // scripts/ingesta_lightdata/sincronizar_clientes_lightdata.py), no se
  // dan de alta ni editan acá. `conteoCuentasPorCliente` se arma en memoria al
  // cargar para no pedir las cuentas de vuelta en cada "Ver detalle".
  let adminClientesData = [];
  let adminClientesBusqueda = "";
  // Solo la CANTIDAD de cuentas por cliente se carga de entrada (columna
  // liviana, un solo `did_cliente` por fila) — las 496 filas completas
  // (con las 7 columnas de IDs externos) se piden recién al abrir el
  // detalle de UN cliente puntual, no de los 296 de la lista entera.
  // Ver reglas_de_negocio.md sección 1, Regla de "consultar lo que se
  // necesita" (2026-11-21).
  let conteoCuentasPorCliente = {}; // did_cliente -> cantidad
  let adminClientesCargado = false; // mismo criterio de caching de arriba

  const TIPO_CUENTA_LABEL = {
    1: "MercadoLibre", 2: "Tienda Nube", 3: "Shopify", 4: "WooCommerce",
  };
  function labelTipoCuenta(t){ return TIPO_CUENTA_LABEL[t] || `Tipo ${t}`; }
  function idsDeCuenta(c){
    // Pedido 2026-11-23: el ID de vendedor de ML no dice nada por sí solo
    // — se muestra el username (ml_user), que sí es identificable a
    // simple vista. Se mantiene el ID como respaldo solo si la cuenta no
    // tiene username cargado todavía.
    return [
      (c.ml_user || c.ml_id_vendedor) && `ML: ${c.ml_user || c.ml_id_vendedor}`,
      c.tn_id && `TN: ${c.tn_id}`,
      c.shop_url && `Shopify: ${c.shop_url}`,
      c.woo_web && `WooCommerce: ${c.woo_web}`,
      c.vtex_url && `VTEX: ${c.vtex_url}`,
      c.pre_url && `PrestaShop: ${c.pre_url}`,
      c.fala_url && `Falabella: ${c.fala_url}`,
    ].filter(Boolean).join(", ") || "—";
  }

  export async function cargarAdminClientes(){
    if(adminClientesCargado){ renderAdminClientes(); return; }
    const [{ data, error }, { data: cuentas, error: errCuentas }, { data: cabeceras, error: errCab }] = await Promise.all([
      sb.from("lightdata_clientes").select("did,codigo,nombre_fantasia,razon_social,habilitado").order("nombre_fantasia"),
      sb.from("lightdata_cuentas").select("did_cliente"),
      sb.from("precios_cliente").select("did_cliente,tipo_servicio,actualizado_en"),
    ]);
    if(error){ console.error("Error cargando lightdata_clientes:", error); return; }
    if(errCuentas) console.error("Error cargando lightdata_cuentas:", errCuentas);
    if(errCab) console.error("Error cargando precios_cliente:", errCab);
    adminClientesData = data || [];
    conteoCuentasPorCliente = {};
    (cuentas || []).forEach(c => { conteoCuentasPorCliente[c.did_cliente] = (conteoCuentasPorCliente[c.did_cliente] || 0) + 1; });
    preciosClienteCabeceraPorDid = {};
    (cabeceras || []).forEach(c => { preciosClienteCabeceraPorDid[c.did_cliente] = c; });
    adminClientesCargado = true;
    renderAdminClientes();
  }

  function renderAdminClientes(){
    const q = adminClientesBusqueda;
    let filas = adminClientesData;
    if(q){
      filas = filas.filter(c =>
        (c.nombre_fantasia || "").toLowerCase().includes(q) ||
        (c.codigo || "").toLowerCase().includes(q)
      );
    }
    const tbody = document.getElementById("tabla-admin-clientes");
    if(!filas.length){
      tbody.innerHTML = `<tr><td colspan="7" class="sin-datos">Sin clientes cargados — ¿corrió ya sincronizar_clientes_lightdata.py?</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(c => {
      const cab = preciosClienteCabeceraPorDid[c.did];
      return `
      <tr data-id="${c.did}" class="${c.habilitado ? "" : "fila-inactiva"}">
        <td>${c.codigo || "—"}</td>
        <td>${c.nombre_fantasia || "—"}</td>
        <td class="texto-muted">${c.razon_social || "—"}</td>
        <td>${c.habilitado ? '<span class="badge verde">Sí</span>' : '<span class="badge gris">No</span>'}</td>
        <td>${conteoCuentasPorCliente[c.did] || 0}</td>
        <td>${cab ? labelTipoServicioPrecio(cab.tipo_servicio) : '<span class="texto-muted">Sin configurar</span>'}</td>
        <td class="col-opciones">
          <span class="opciones-fila">
            <button type="button" class="btn-icono-chico ver" data-id="${c.did}" title="Ver detalle"><i data-lucide="eye"></i></button>
            <button type="button" class="btn-icono-chico configurar-colectas" data-did="${c.did}" title="Dirección y días de colecta"><i data-lucide="map-pin"></i></button>
            <button type="button" class="btn-icono-chico configurar-precios" data-did="${c.did}" title="Configurar precios"><i data-lucide="dollar-sign"></i></button>
          </span>
        </td>
      </tr>
    `;
    }).join("");
    lucide.createIcons();
  }

  document.getElementById("buscar-admin-clientes").addEventListener("input", (e)=>{
    adminClientesBusqueda = e.target.value.trim().toLowerCase();
    renderAdminClientes();
  });

  async function abrirDetalleCliente(did){
    const c = adminClientesData.find(x => String(x.did) === String(did));
    if(!c) return;
    document.getElementById("modal-detalle-cliente-titulo").textContent = `Cliente — ${c.nombre_fantasia || c.did}`;
    const campos = [
      { icono: "hash", label: "Código", valor: c.codigo || "—" },
      { icono: "building-2", label: "Nombre de fantasía", valor: c.nombre_fantasia || "—" },
      { icono: "file-text", label: "Razón social", valor: c.razon_social || "—" },
      { icono: "check-circle-2", label: "Habilitado", valor: c.habilitado ? "Sí" : "No" },
    ];
    document.getElementById("modal-detalle-cliente-cuerpo").innerHTML = `
      <div class="grid-detalle-compacto">
        ${campos.map(c => `
          <div class="campo-detalle">
            <span class="campo-detalle-label"><i data-lucide="${c.icono}"></i>${c.label}</span>
            <span class="campo-detalle-valor">${c.valor}</span>
          </div>
        `).join("")}
      </div>
      <h3 style="margin-bottom:0;">Cuentas asociadas</h3>
      <div class="tabla-scroll tabla-cuentas-cliente-scroll"><p class="sin-datos">Cargando…</p></div>
    `;
    lucide.createIcons();
    document.getElementById("modal-detalle-cliente").hidden = false;

    // Las cuentas completas (7 columnas de IDs externos) se piden recién
    // acá, para ESTE cliente puntual — no en cargarAdminClientes() para
    // los 296 clientes de la lista (ver Regla de consultas en
    // reglas_de_negocio.md, 2026-11-21).
    const { data: cuentas, error } = await sb.from("lightdata_cuentas").select("*").eq("did_cliente", did);
    if(error) console.error("Error cargando cuentas del cliente:", error);
    const tablaCuentas = (cuentas || []).length ? `
      <table style="margin-top:10px;">
        <thead><tr><th>Integración</th><th>IDs</th></tr></thead>
        <tbody>
          ${cuentas.map(cu => `<tr><td>${labelTipoCuenta(cu.tipo_cuenta)}</td><td>${idsDeCuenta(cu)}</td></tr>`).join("")}
        </tbody>
      </table>
    ` : `<p class="sin-datos">Sin cuentas asociadas.</p>`;
    const contCuentas = document.querySelector("#modal-detalle-cliente-cuerpo .tabla-cuentas-cliente-scroll");
    if(contCuentas) contCuentas.innerHTML = tablaCuentas;
  }
  document.getElementById("modal-detalle-cliente-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-detalle-cliente").hidden = true;
  });
  document.getElementById("modal-detalle-cliente").addEventListener("click", (e)=>{
    if(e.target.id === "modal-detalle-cliente") document.getElementById("modal-detalle-cliente").hidden = true;
  });

  // ----- Precios por cliente (pedido 2026-11-20, movido AL módulo de
  // Clientes el 2026-11-21 — el usuario pidió que viva ahí, ya que el
  // precio se asocia 1 a 1 con cada cliente, no en una sección aparte):
  // tarifario de Última milla / Fulfillment — matriz de envíos (tamaño ×
  // cordón), flete por cordón, y para Fulfillment el precio unitario de
  // depósito (por pallet) y despacho (por envío); la CANTIDAD de
  // pallets/envíos se calcula después, en la liquidación — acá solo se
  // cargan los precios. `preciosClienteCabeceraPorDid` se llena en
  // cargarAdminClientes() junto con el resto de los datos del cliente.
  let preciosClienteCabeceraPorDid = {};
  let preciosClienteAbriendoDid = null;

  function labelTipoServicioPrecio(t){
    return t === "fulfillment" ? "Fulfillment" : "Última milla";
  }

  document.getElementById("tabla-admin-clientes").addEventListener("click", (e)=>{
    const btnPrecios = e.target.closest(".configurar-precios");
    if(btnPrecios) abrirPreciosCliente(Number(btnPrecios.dataset.did));
    const btnColectas = e.target.closest(".configurar-colectas");
    if(btnColectas) abrirColectasCliente(Number(btnColectas.dataset.did));
  });

  // ===================== Clientes: Dirección y días de colecta =====================
  // Pedido 2026-11-24: puerto de la hoja "Base_Colectas" de
  // "1. Informacion Base Repartidores.xlsx" — un mismo cliente puede
  // tener VARIAS direcciones/turnos (confirmado con datos reales), por
  // eso es una lista editable (clientes_colectas), no campos sueltos en
  // lightdata_clientes. El formulario de alta/edición es un bloque
  // inline dentro del mismo modal (no un abrirModalAbm anidado, para no
  // lidiar con z-index de un modal arriba de otro).
  let colectasClienteAbriendoDid = null;
  let colectasClienteData = [];
  let colectaEditandoId = null;

  async function abrirColectasCliente(did){
    colectasClienteAbriendoDid = did;
    const cliente = adminClientesData.find(c => c.did === did);
    document.getElementById("modal-colectas-cliente-titulo").textContent = `Dirección y colecta — ${cliente ? nombreCliente(cliente) : did}`;
    document.getElementById("form-colecta-cliente").hidden = true;
    const { data, error } = await sb.from("clientes_colectas").select("*").eq("did_cliente", did).order("id");
    if(error){ console.error("Error cargando clientes_colectas:", error); return; }
    colectasClienteData = data || [];
    renderColectasCliente();
    document.getElementById("modal-colectas-cliente").hidden = false;
  }

  function renderColectasCliente(){
    const tbody = document.getElementById("tabla-colectas-cliente");
    if(!colectasClienteData.length){
      tbody.innerHTML = `<tr><td colspan="7" class="sin-datos">Sin direcciones de colecta cargadas.</td></tr>`;
      return;
    }
    tbody.innerHTML = colectasClienteData.map(f => `
      <tr data-id="${f.id}" class="${f.activo ? "" : "fila-inactiva"}">
        <td>${tituloTexto(f.direccion)}</td>
        <td>${tituloTexto(f.localidad) || "—"}</td>
        <td>${tituloTexto(f.turno) || "—"}</td>
        <td>${tituloTexto(f.dias) || "—"}</td>
        <td>${f.refuerzo ? "Sí" : "No"}</td>
        <td>${f.hora ? f.hora.slice(0, 5) : "—"}</td>
        <td class="col-opciones">
          <span class="opciones-fila">
            <button type="button" class="btn-icono-chico editar" data-id="${f.id}" title="Editar"><i data-lucide="pencil"></i></button>
            <button type="button" class="btn-icono-chico borrar" data-id="${f.id}" title="Borrar"><i data-lucide="trash-2"></i></button>
          </span>
        </td>
      </tr>
    `).join("");
    lucide.createIcons();
  }

  const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

  function abrirFormColecta(fila){
    colectaEditandoId = fila ? fila.id : null;
    document.getElementById("colecta-direccion").value = fila ? fila.direccion : "";
    document.getElementById("colecta-localidad").value = fila ? (fila.localidad || "") : "";

    const turnoSel = document.getElementById("colecta-turno");
    const turnoActual = fila ? (fila.turno || "") : "";
    turnoSel.innerHTML = `<option value="">— Sin turno —</option>` + abmTurnos.obtenerActivos()
      .map(h => `<option value="${h}" ${h === turnoActual ? "selected" : ""}>${h}</option>`).join("")
      + (turnoActual && !abmTurnos.obtenerActivos().includes(turnoActual) ? `<option value="${turnoActual}" selected>${turnoActual}</option>` : "");

    const diasSeleccionados = new Set((fila && fila.dias ? fila.dias.split(",") : []).map(s => s.trim()).filter(Boolean));
    const diasCombo = document.getElementById("colecta-dias-combo");
    diasCombo.dataset.valorActual = [...diasSeleccionados].join(", ");
    diasCombo.querySelector(".combo-filtro-btn").textContent = diasSeleccionados.size ? [...diasSeleccionados].join(", ") : "Elegir…";
    diasCombo.querySelectorAll("input[type=checkbox]").forEach(chk => { chk.checked = diasSeleccionados.has(chk.value); });

    document.getElementById("colecta-hora").value = fila ? (fila.hora ? fila.hora.slice(0, 5) : "") : "";
    document.getElementById("colecta-refuerzo").checked = fila ? !!fila.refuerzo : false;
    document.getElementById("colecta-observaciones").value = fila ? (fila.observaciones || "") : "";
    document.getElementById("form-colecta-cliente").hidden = false;
  }

  async function borrarColectaCliente(id){
    if(!(await mostrarConfirmacion("¿Borrar esta dirección/colecta? No se puede deshacer."))) return;
    const { error } = await sb.from("clientes_colectas").delete().eq("id", id);
    if(error){ console.error(error); await mostrarAviso("No se pudo borrar."); return; }
    colectasClienteData = colectasClienteData.filter(f => f.id !== id);
    renderColectasCliente();
  }

  // Días: checkboxes fijos (7 días, no cambian), se wirean una sola vez
  // al cargar la página — mismo criterio que el resto de los combos/
  // multiselects (crearComboGenerico/crearMultiSelectGenerico no se
  // pueden volver a llamar sobre el mismo contenedor).
  document.getElementById("colecta-dias-opciones").innerHTML = DIAS_SEMANA
    .map(d => `<label class="check-columna"><input type="checkbox" value="${d}" /> ${d}</label>`).join("");
  crearMultiSelectGenerico("colecta-dias-combo");

  document.getElementById("btn-agregar-colecta-cliente").addEventListener("click", ()=> abrirFormColecta(null));
  document.getElementById("btn-cancelar-colecta-cliente").addEventListener("click", ()=>{
    document.getElementById("form-colecta-cliente").hidden = true;
  });
  document.getElementById("tabla-colectas-cliente").addEventListener("click", (e)=>{
    const btnEditar = e.target.closest(".btn-icono-chico.editar");
    const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
    if(btnEditar){
      const fila = colectasClienteData.find(f => f.id === Number(btnEditar.dataset.id));
      if(fila) abrirFormColecta(fila);
    }
    if(btnBorrar) borrarColectaCliente(Number(btnBorrar.dataset.id));
  });
  document.getElementById("btn-guardar-colecta-cliente").addEventListener("click", async ()=>{
    const direccion = document.getElementById("colecta-direccion").value.trim();
    if(!direccion){ await mostrarAviso("La dirección es obligatoria."); return; }
    const payload = {
      did_cliente: colectasClienteAbriendoDid,
      direccion,
      localidad: document.getElementById("colecta-localidad").value.trim() || null,
      turno: document.getElementById("colecta-turno").value || null,
      dias: document.getElementById("colecta-dias-combo").dataset.valorActual || null,
      hora: document.getElementById("colecta-hora").value || null,
      refuerzo: document.getElementById("colecta-refuerzo").checked,
      observaciones: document.getElementById("colecta-observaciones").value.trim() || null,
    };
    const btn = document.getElementById("btn-guardar-colecta-cliente");
    btn.disabled = true;
    try {
      const resultado = colectaEditandoId
        ? await sb.from("clientes_colectas").update(payload).eq("id", colectaEditandoId).select().single()
        : await sb.from("clientes_colectas").insert(payload).select().single();
      if(resultado.error){ console.error("Error guardando clientes_colectas:", resultado.error); await mostrarAviso("No se pudo guardar."); return; }
      if(colectaEditandoId){
        const idx = colectasClienteData.findIndex(f => f.id === colectaEditandoId);
        if(idx !== -1) colectasClienteData[idx] = resultado.data;
      } else {
        colectasClienteData.push(resultado.data);
      }
      renderColectasCliente();
      document.getElementById("form-colecta-cliente").hidden = true;
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById("modal-colectas-cliente-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-colectas-cliente").hidden = true;
  });
  document.getElementById("modal-colectas-cliente").addEventListener("click", (e)=>{
    if(e.target.id === "modal-colectas-cliente") document.getElementById("modal-colectas-cliente").hidden = true;
  });

  function actualizarVisibilidadFulfillment(){
    const tipo = document.getElementById("combo-precios-cliente-tipo-servicio").dataset.valorActual;
    document.getElementById("precios-cliente-fulfillment-campos").hidden = tipo !== "fulfillment";
  }
  crearComboGenerico("combo-precios-cliente-tipo-servicio", (valor)=>{
    document.getElementById("combo-precios-cliente-tipo-servicio").dataset.valorActual = valor;
    actualizarVisibilidadFulfillment();
  });

  async function abrirPreciosCliente(did){
    const cliente = adminClientesData.find(c => c.did === did);
    if(!cliente) return;
    preciosClienteAbriendoDid = did;
    await Promise.all([abmCordones.cargar(), abmTamanosPaquete.cargar()]);
    const cordones = abmCordones.obtenerActivosConId();
    const tamanos = abmTamanosPaquete.obtenerActivosConId();

    const { data: cab } = await sb.from("precios_cliente").select("*").eq("did_cliente", did).maybeSingle();
    let envios = [], flete = [];
    if(cab){
      const [{ data: e }, { data: f }] = await Promise.all([
        sb.from("precios_cliente_envio").select("*").eq("precios_cliente_id", cab.id),
        sb.from("precios_cliente_flete").select("*").eq("precios_cliente_id", cab.id),
      ]);
      envios = e || []; flete = f || [];
    }
    const precioEnvio = (tamanoId, cordonId) => {
      const f = envios.find(x => x.tamano_paquete_id === tamanoId && x.cordon_id === cordonId);
      return formatearMoneda(f ? f.precio : null);
    };
    const precioFlete = (cordonId) => {
      const f = flete.find(x => x.cordon_id === cordonId);
      return formatearMoneda(f ? f.precio : null);
    };

    document.getElementById("modal-precios-cliente-titulo").textContent = `Precios — ${nombreCliente(cliente)}`;
    const tipoServicio = cab ? cab.tipo_servicio : "ultima_milla";
    const comboTipo = document.getElementById("combo-precios-cliente-tipo-servicio");
    comboTipo.dataset.valorActual = tipoServicio;
    comboTipo.querySelector(".combo-filtro-btn").textContent = labelTipoServicioPrecio(tipoServicio) === "Fulfillment" ? "Fulfillment (última milla + almacenamiento)" : "Última milla";
    comboTipo.querySelectorAll("li").forEach(li => li.setAttribute("aria-selected", String(li.dataset.valor === tipoServicio)));
    actualizarVisibilidadFulfillment();

    document.getElementById("modal-precios-cliente-deposito").value = formatearMoneda(cab ? cab.precio_deposito_pallet : null);
    document.getElementById("modal-precios-cliente-despacho").value = formatearMoneda(cab ? cab.precio_despacho_envio : null);
    document.getElementById("modal-precios-cliente-turbo").value = formatearMoneda(cab ? cab.precio_turbo_envio : null);
    document.getElementById("modal-precios-cliente-colecta").value = formatearMoneda(cab ? cab.precio_colecta : null);

    if(!cordones.length || !tamanos.length){
      document.getElementById("precios-cliente-matriz-envios").innerHTML = `<p class="sin-datos">Cargá al menos un Tamaño de paquete y un Cordón en Configuración antes de armar el tarifario.</p>`;
      document.getElementById("precios-cliente-matriz-flete").innerHTML = "";
    } else {
      document.getElementById("precios-cliente-matriz-envios").innerHTML = `
        <table>
          <thead><tr><th>Tamaño \\ Cordón</th>${cordones.map(c => `<th>${c.texto}</th>`).join("")}</tr></thead>
          <tbody>
            ${tamanos.map(t => `
              <tr>
                <td>${t.texto}</td>
                ${cordones.map(c => `<td><input type="text" inputmode="decimal" class="cel-input input-moneda precio-envio-input" data-tamano="${t.valor}" data-cordon="${c.valor}" value="${precioEnvio(t.valor, c.valor)}" /></td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
      document.getElementById("precios-cliente-matriz-flete").innerHTML = `
        <table>
          <thead><tr>${cordones.map(c => `<th>${c.texto}</th>`).join("")}</tr></thead>
          <tbody>
            <tr>${cordones.map(c => `<td><input type="text" inputmode="decimal" class="cel-input input-moneda precio-flete-input" data-cordon="${c.valor}" value="${precioFlete(c.valor)}" /></td>`).join("")}</tr>
          </tbody>
        </table>
      `;
    }
    document.getElementById("modal-precios-cliente").hidden = false;
  }

  // Reformatea a "$ 0.000,00" al salir del campo (delegado en el modal
  // porque los inputs de la matriz se arman dinámicamente en cada
  // apertura — ver Regla 7 de sección 1). Mientras se está escribiendo
  // se deja el valor tal cual lo tipea la persona, reformatear en cada
  // tecla saltaría el cursor al final todo el tiempo.
  document.getElementById("modal-precios-cliente").addEventListener("focusout", (e)=>{
    if(e.target.classList && e.target.classList.contains("input-moneda")){
      e.target.value = formatearMoneda(parsearMoneda(e.target.value));
    }
  });

  document.getElementById("modal-precios-cliente-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-precios-cliente").hidden = true;
  });
  document.getElementById("modal-precios-cliente").addEventListener("click", (e)=>{
    if(e.target.id === "modal-precios-cliente") document.getElementById("modal-precios-cliente").hidden = true;
  });
  document.getElementById("modal-precios-cliente-guardar").addEventListener("click", async ()=>{
    const did = preciosClienteAbriendoDid;
    if(!did) return;
    const btn = document.getElementById("modal-precios-cliente-guardar");
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      const tipoServicio = document.getElementById("combo-precios-cliente-tipo-servicio").dataset.valorActual || "ultima_milla";
      const deposito = parsearMoneda(document.getElementById("modal-precios-cliente-deposito").value);
      const despacho = parsearMoneda(document.getElementById("modal-precios-cliente-despacho").value);
      const turbo = parsearMoneda(document.getElementById("modal-precios-cliente-turbo").value);
      const colecta = parsearMoneda(document.getElementById("modal-precios-cliente-colecta").value);

      const { data: cab, error: errCab } = await sb.from("precios_cliente")
        .upsert({
          did_cliente: did,
          tipo_servicio: tipoServicio,
          precio_deposito_pallet: deposito,
          precio_despacho_envio: despacho,
          precio_turbo_envio: turbo,
          precio_colecta: colecta,
          actualizado_en: new Date().toISOString(),
        }, { onConflict: "did_cliente" })
        .select().single();
      if(errCab){ console.error("Error guardando precios_cliente:", errCab); await mostrarAviso("No se pudo guardar."); return; }

      const filasEnvio = [...document.querySelectorAll(".precio-envio-input")]
        .map(inp => ({ inp, precio: parsearMoneda(inp.value) }))
        .filter(x => x.precio != null)
        .map(x => ({ precios_cliente_id: cab.id, tamano_paquete_id: Number(x.inp.dataset.tamano), cordon_id: Number(x.inp.dataset.cordon), precio: x.precio }));
      const filasFlete = [...document.querySelectorAll(".precio-flete-input")]
        .map(inp => ({ inp, precio: parsearMoneda(inp.value) }))
        .filter(x => x.precio != null)
        .map(x => ({ precios_cliente_id: cab.id, cordon_id: Number(x.inp.dataset.cordon), precio: x.precio }));

      await Promise.all([
        sb.from("precios_cliente_envio").delete().eq("precios_cliente_id", cab.id),
        sb.from("precios_cliente_flete").delete().eq("precios_cliente_id", cab.id),
      ]);
      if(filasEnvio.length){
        const { error } = await sb.from("precios_cliente_envio").insert(filasEnvio);
        if(error){ console.error("Error guardando precios_cliente_envio:", error); await mostrarAviso("Se guardó la cabecera pero no toda la matriz de envíos."); }
      }
      if(filasFlete.length){
        const { error } = await sb.from("precios_cliente_flete").insert(filasFlete);
        if(error){ console.error("Error guardando precios_cliente_flete:", error); await mostrarAviso("Se guardó la cabecera pero no el flete."); }
      }

      preciosClienteCabeceraPorDid[did] = cab;
      renderAdminClientes();
      document.getElementById("modal-precios-cliente").hidden = true;
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
  document.getElementById("tabla-admin-clientes").addEventListener("click", (e)=>{
    const btn = e.target.closest(".btn-icono-chico.ver");
    if(btn) abrirDetalleCliente(btn.dataset.id);
  });
