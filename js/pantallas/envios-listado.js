// Envíos (listado): cada envío individual con filtros (fecha/estado/origen/
// tamaño/cliente/localidad/cordón/repartidor), paginación y detalle.
// Viene de index.html (Etapa 4c de migración a ES Modules, 2026-11-25).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { formatearFechaHora, tituloTexto } from "../core/formato.js";
import { crearComboGenerico, crearPopoverGenerico, agregarOpcionesCombo } from "../ui/combos.js";
import { abmCordones } from "../admin/abm-simple.js";
import { abmLocalidades } from "../admin/abm-localidades.js";
import { fechaART, limiteDiaART, diaSiguienteStr, lunesDeSemana } from "../core/fechas.js";
import { stateFallidos, tieneLogisticaInversaReal, cargarNombresPorLightdataId, nombreRepartidorFallido, direccionDe, cordonDe } from "./fallidos.js";
import { catalogos, nombreCliente } from "../core/catalogos.js";
import { stateSesion } from "../core/sesion.js";

  // Pedido 2026-11-25: de cara a un usuario tipo_usuario="cliente" los
  // tamaños se agrupan en Pequeños/Grandes (Grandes = Mediano Y Grande
  // reales), igual que en Mis Liquidaciones y el ABM de precios — para
  // personal administrativo esta misma pantalla sigue mostrando los 3
  // tamaños reales tal cual (acá sí hace falta la distinción operativa).
  // No se toca `envios.tamano` en la base, solo cómo se muestra/filtra.
  function esUsuarioCliente(){
    return !!(stateSesion.perfil && stateSesion.perfil.tipo_usuario === "cliente");
  }
  function labelTamanoEnvio(tamano){
    const t = tituloTexto(tamano) || "Pequeño";
    if(!esUsuarioCliente()) return t;
    return t === "Pequeño" ? "Pequeños" : "Grandes";
  }

  // ======================================================================
  // Envíos (listado) — pedido 2026-11-20. Distinto del Dashboard de
  // arriba (agregados/gráficos): acá se lista cada envío individual, con
  // filtros de texto/fecha/estado/origen y detalle completo. El acceso
  // por cliente (un usuario tipo Cliente solo ve SUS envíos) no se filtra
  // acá en JS — lo hace la RLS restrictiva de la base (ver
  // reglas_de_negocio.md sección 2, "Acceso por cliente"), así que esta
  // pantalla simplemente pide "todos los envíos del rango" y Supabase ya
  // devuelve solo los permitidos para quien está logueado.
  // `zona` (crudo de Lightdata, no confiable) ya no se trae para mostrar —
  // "Cordón" (pedido 2026-11-23) viene de envios.cordon_id, resuelto por
  // Localidad+CP (ver migración 2026-11-23_mapeo_localidad_cordon.sql),
  // embebido por FK igual que envios_contacto_destinatario(direccion).
  const COLUMNAS_ENVIOS_LISTADO = "id_interno,tracking,id_venta_ml,cliente,localidad,cordon_id,cadete,chofer_lightdata_id,did_cliente,origen,estado,fecha_mercadopacks,fecha_venta,fecha_estado,fecha_asignacion,fecha_a_planta,fecha_colecta,logistica_inversa,logistica_inversa_real,observaciones,tamano,envios_contacto_destinatario(direccion),parametros_cordones(nombre)";

  // Pedido 2026-11-22: por defecto se filtra solo la última semana (antes
  // traía 30 días) para no cargar tantos datos en pantalla de entrada.
  // Pedido 2026-11-27: "última semana" pasa a ser la semana EN CURSO
  // (lunes a hoy), no los últimos 7 días corridos — si hoy es viernes,
  // arranca el lunes de esta semana, no el viernes pasado.
  const stateEnviosListado = {
    busqueda: "", estado: "", origen: "", tamano: "", cliente: "", localidad: "", cordon: "", repartidor: "",
    desde: lunesDeSemana(fechaART(0)), hasta: fechaART(0),
    filas: [], paginaActual: 0, tamanoPagina: 10, total: 0, cargando: false,
  };

  function construirQueryEnviosListado(){
    // `count: "exact"` para mostrar el total real de la consulta (pedido
    // 2026-11-20: "un total de los registros que trajo la consulta"), no
    // solo la página actual.
    let q = sb.from("envios").select(COLUMNAS_ENVIOS_LISTADO, { count: "exact" })
      .gte("fecha_mercadopacks", limiteDiaART(stateEnviosListado.desde))
      .lt("fecha_mercadopacks", limiteDiaART(diaSiguienteStr(stateEnviosListado.hasta)))
      .order("fecha_mercadopacks", { ascending: false });
    if(stateEnviosListado.estado) q = q.eq("estado", stateEnviosListado.estado);
    if(stateEnviosListado.origen) q = q.eq("origen", stateEnviosListado.origen);
    // "Grandes" (opción agrupada del filtro para usuarios cliente, ver
    // esUsuarioCliente()) matchea los 2 tamaños reales Mediano Y Grande.
    if(stateEnviosListado.tamano === "Grandes") q = q.in("tamano", ["Mediano", "Grande"]);
    else if(stateEnviosListado.tamano) q = q.eq("tamano", stateEnviosListado.tamano);
    if(stateEnviosListado.cliente) q = q.eq("did_cliente", stateEnviosListado.cliente);
    // `ilike` (no `eq`) para localidad/zona: son texto libre de Lightdata,
    // mezcla de mayúsculas/minúsculas (Regla 15 de sección 1) — comparar
    // exacto contra el valor de `parametros_localidades`/`parametros_zonas`
    // (que sí está prolijo) fallaría en silencio contra el dato crudo.
    if(stateEnviosListado.localidad) q = q.ilike("localidad", stateEnviosListado.localidad);
    if(stateEnviosListado.cordon === "sin_clasificar") q = q.is("cordon_id", null);
    else if(stateEnviosListado.cordon) q = q.eq("cordon_id", stateEnviosListado.cordon);
    if(stateEnviosListado.repartidor) q = q.eq("chofer_lightdata_id", stateEnviosListado.repartidor);
    if(stateEnviosListado.busqueda){
      const b = stateEnviosListado.busqueda.replace(/[%,]/g, "");
      q = q.or(`tracking.ilike.%${b}%,cliente.ilike.%${b}%,localidad.ilike.%${b}%`);
    }
    return q;
  }

  export async function cargarEnviosListado(reset){
    if(stateEnviosListado.cargando) return;
    if(reset) stateEnviosListado.paginaActual = 0;
    stateEnviosListado.cargando = true;

    await cargarNombresPorLightdataId(); // mismo roster que usa Fallidos, para mostrar el nombre real del repartidor

    const tam = stateEnviosListado.tamanoPagina;
    const desde = stateEnviosListado.paginaActual * tam;
    const { data, error, count } = await construirQueryEnviosListado().range(desde, desde + tam - 1);
    stateEnviosListado.cargando = false;
    if(error){
      console.error("Error cargando envíos:", error);
      document.getElementById("tabla-envios-listado").innerHTML = `<tr><td colspan="11" class="sin-datos">Error cargando los datos.</td></tr>`;
      return;
    }
    stateEnviosListado.filas = data || [];
    stateEnviosListado.total = count || 0;
    renderEnviosListado();
  }

  function renderEnviosListado(){
    const tbody = document.getElementById("tabla-envios-listado");
    const filas = stateEnviosListado.filas;
    if(!filas.length){
      tbody.innerHTML = `<tr><td colspan="11" class="sin-datos">Sin envíos para este filtro.</td></tr>`;
    } else {
      tbody.innerHTML = filas.map(e => `
        <tr data-id="${e.id_interno}">
          <td>${formatearFechaHora(e.fecha_mercadopacks)}</td>
          <td>${e.origen || "—"}</td>
          <td>${e.tracking || "—"}</td>
          <td>${e.id_venta_ml || "—"}</td>
          <td>${tituloTexto(e.cliente) || "—"}</td>
          <td>${tituloTexto(e.localidad) || "—"}</td>
          <td>${direccionDe(e)}</td>
          <td>${cordonDe(e) || '<span class="badge-pendiente-cordon">Sin clasificar</span>'}</td>
          <td>${labelTamanoEnvio(e.tamano)}</td>
          <td>${tituloTexto(e.estado) || "—"}</td>
          <td class="col-opciones">
            <span class="opciones-fila">
              <button type="button" class="btn-icono-chico ver" data-id="${e.id_interno}" title="Detalle"><i data-lucide="eye"></i></button>
            </span>
          </td>
        </tr>
      `).join("");
      lucide.createIcons();
    }

    const total = stateEnviosListado.total;
    const tam = stateEnviosListado.tamanoPagina;
    const totalPaginas = Math.max(1, Math.ceil(total / tam));
    const paginaActual = Math.min(stateEnviosListado.paginaActual, totalPaginas - 1);
    stateEnviosListado.paginaActual = paginaActual;
    const desdeFila = total ? paginaActual * tam + 1 : 0;
    const hastaFila = Math.min(total, (paginaActual + 1) * tam);
    document.getElementById("envios-listado-resumen").textContent =
      total ? `Mostrando ${desdeFila}–${hastaFila} de ${total} envíos` : "Sin envíos para este filtro.";
    document.getElementById("btn-envios-listado-anterior").disabled = paginaActual <= 0;
    document.getElementById("btn-envios-listado-siguiente").disabled = paginaActual >= totalPaginas - 1;
  }

  function abrirDetalleEnvio(id){
    const e = stateEnviosListado.filas.find(x => String(x.id_interno) === String(id));
    if(!e) return;
    document.getElementById("modal-detalle-envio-titulo").textContent = `Envío — ${e.tracking || e.id_interno}`;
    const esCambio = e.logistica_inversa_real === true
      || (e.logistica_inversa_real == null && tieneLogisticaInversaReal(e.logistica_inversa));
    const campos = [
      { icono: "hash", label: "Tracking", valor: e.tracking || "—" },
      { icono: "shopping-cart", label: "ID de venta", valor: e.id_venta_ml || "—" },
      { icono: "building-2", label: "Cliente", valor: tituloTexto(e.cliente) || "—" },
      { icono: "map-pin", label: "Localidad", valor: tituloTexto(e.localidad) || "—" },
      { icono: "home", label: "Dirección", valor: direccionDe(e) },
      { icono: "map", label: "Cordón", valor: cordonDe(e) || "Sin clasificar" },
      { icono: "box", label: "Tamaño", valor: labelTamanoEnvio(e.tamano) },
      { icono: "truck", label: "Repartidor", valor: tituloTexto(nombreRepartidorFallido(e)) },
      { icono: "package", label: "Origen", valor: e.origen || "—" },
      { icono: "info", label: "Estado", valor: tituloTexto(e.estado) || "—" },
      { icono: "calendar", label: "Fecha Mercadopacks", valor: formatearFechaHora(e.fecha_mercadopacks) },
      { icono: "calendar", label: "Fecha venta", valor: formatearFechaHora(e.fecha_venta) },
      { icono: "calendar", label: "Fecha estado", valor: formatearFechaHora(e.fecha_estado) },
      { icono: "calendar", label: "Fecha asignación", valor: formatearFechaHora(e.fecha_asignacion) },
      { icono: "calendar", label: "Fecha a planta", valor: formatearFechaHora(e.fecha_a_planta) },
      { icono: "calendar", label: "Fecha colecta", valor: formatearFechaHora(e.fecha_colecta) },
      { icono: "rotate-ccw", label: "Logística inversa", valor: esCambio ? "Sí" : "No" },
      { icono: "message-square", label: "Observaciones", valor: e.observaciones || "—", span: true },
    ];
    document.getElementById("modal-detalle-envio-cuerpo").innerHTML = `
      <div class="grid-detalle-compacto">
        ${campos.map(c => `
          <div class="campo-detalle${c.span ? " campo-span-completo" : ""}">
            <span class="campo-detalle-label"><i data-lucide="${c.icono}"></i>${c.label}</span>
            <span class="campo-detalle-valor">${c.valor}</span>
          </div>
        `).join("")}
      </div>
    `;
    lucide.createIcons();
    document.getElementById("modal-detalle-envio").hidden = false;
  }
  document.getElementById("modal-detalle-envio-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-detalle-envio").hidden = true;
  });
  document.getElementById("modal-detalle-envio").addEventListener("click", (e)=>{
    if(e.target.id === "modal-detalle-envio") document.getElementById("modal-detalle-envio").hidden = true;
  });
  document.getElementById("tabla-envios-listado").addEventListener("click", (e)=>{
    const btn = e.target.closest(".btn-icono-chico.ver");
    if(btn) abrirDetalleEnvio(btn.dataset.id);
  });

  document.getElementById("btn-envios-listado-anterior").addEventListener("click", ()=>{
    if(stateEnviosListado.paginaActual <= 0) return;
    stateEnviosListado.paginaActual--;
    cargarEnviosListado(false);
  });
  document.getElementById("btn-envios-listado-siguiente").addEventListener("click", ()=>{
    const totalPaginas = Math.max(1, Math.ceil(stateEnviosListado.total / stateEnviosListado.tamanoPagina));
    if(stateEnviosListado.paginaActual >= totalPaginas - 1) return;
    stateEnviosListado.paginaActual++;
    cargarEnviosListado(false);
  });
  crearComboGenerico("combo-tamano-envios-listado", (valor)=>{
    stateEnviosListado.tamanoPagina = Number(valor) || 10;
    cargarEnviosListado(true);
  });

  // Buscador con debounce (acá SÍ hace falta — a diferencia de Fallidos,
  // que filtra un array ya cargado en memoria, esto re-consulta la base
  // por la paginación) — 350ms para no disparar una consulta por tecla.
  let debounceEnviosListado = null;
  document.getElementById("buscar-envios-listado").addEventListener("input", (e)=>{
    stateEnviosListado.busqueda = e.target.value.trim();
    clearTimeout(debounceEnviosListado);
    debounceEnviosListado = setTimeout(()=> cargarEnviosListado(true), 350);
  });
  document.getElementById("envios-listado-desde").value = stateEnviosListado.desde;
  document.getElementById("envios-listado-hasta").value = stateEnviosListado.hasta;
  document.getElementById("envios-listado-desde").addEventListener("change", (e)=>{
    stateEnviosListado.desde = e.target.value || lunesDeSemana(fechaART(0));
    cargarEnviosListado(true);
  });
  document.getElementById("envios-listado-hasta").addEventListener("change", (e)=>{
    stateEnviosListado.hasta = e.target.value || fechaART(0);
    cargarEnviosListado(true);
  });
  crearComboGenerico("combo-estado-envios-listado", (valor)=>{ stateEnviosListado.estado = valor; cargarEnviosListado(true); });
  crearComboGenerico("combo-origen-envios-listado", (valor)=>{ stateEnviosListado.origen = valor; cargarEnviosListado(true); });
  crearComboGenerico("combo-tamano-filtro-envios-listado", (valor)=>{ stateEnviosListado.tamano = valor; cargarEnviosListado(true); });
  crearPopoverGenerico("popover-filtros-envios-listado");

  // Cliente/Localidad/Zona/Repartidor (pedido 2026-11-20): listas largas
  // que vienen de la base, no se pueden poner directo en el HTML como
  // Estado/Origen — se arman una sola vez, la primera vez que se entra a
  // la pantalla (los <li> tienen que existir ANTES de crearComboGenerico,
  // que solo engancha los eventos de los que ve en ese momento).
  // Pedido 2026-11-26: el filtro de Cliente sale del panel "Filtrar" y
  // queda siempre visible afuera (mismo patrón que el selector de
  // cliente de Mis Liquidaciones, ver mis-liquidaciones.js). Para un
  // usuario tipo_usuario="cliente" se acota a sus propios clientes
  // vinculados (clientes_lightdata_ids) — antes se le ofrecía el catálogo
  // COMPLETO de clientes en el mismo combo que usa un administrativo, y
  // el filtro arrancaba vacío ("Todos"), por lo que la grilla mostraba
  // los envíos de TODOS los clientes (la RLS restringe cuáles puede leer,
  // pero nada lo dejaba pre-filtrado a los suyos en la pantalla).
  let clientesFiltroEnviosCache = null;
  async function resolverClientesFiltroEnvios(){
    if(clientesFiltroEnviosCache) return clientesFiltroEnviosCache;
    if(esUsuarioCliente()){
      const ids = (stateSesion.perfil && stateSesion.perfil.clientes_lightdata_ids) || [];
      if(!ids.length){ clientesFiltroEnviosCache = []; return clientesFiltroEnviosCache; }
      const { data, error } = await sb.from("lightdata_clientes").select("did,codigo,nombre_fantasia").in("did", ids);
      if(error) console.error("Error cargando clientes propios para filtro de Envíos:", error);
      clientesFiltroEnviosCache = data || [];
      return clientesFiltroEnviosCache;
    }
    if(!catalogos.clientes.length){
      const { data, error } = await sb.from("lightdata_clientes").select("did,codigo,nombre_fantasia").eq("habilitado", true).order("nombre_fantasia");
      if(error) console.error("Error cargando lightdata_clientes para el filtro:", error);
      else catalogos.clientes = data || [];
    }
    clientesFiltroEnviosCache = catalogos.clientes;
    return clientesFiltroEnviosCache;
  }

  function repoblarComboClienteEnviosListado(clientes){
    const wrap = document.getElementById("combo-cliente-envios-listado-wrap");
    if(esUsuarioCliente()){
      // Un cliente no elige nada acá: queda fijo a su propio did (o, si
      // tiene más de una cuenta vinculada, a un combo acotado solo a
      // esas) — nunca al catálogo completo.
      stateEnviosListado.cliente = clientes.length ? String(clientes[0].did) : "";
      if(clientes.length <= 1){ wrap.innerHTML = ""; return; }
    } else {
      stateEnviosListado.cliente = "";
    }
    const actual = stateEnviosListado.cliente;
    const actualTexto = actual ? nombreCliente(clientes.find(c => String(c.did) === String(actual)) || {}) : "Todos";
    wrap.innerHTML = `
      <div class="combo-filtro" id="combo-cliente-envios-listado">
        <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${tituloTexto(actualTexto)}</button>
        <ul class="combo-filtro-lista" role="listbox" hidden>
          ${esUsuarioCliente() ? "" : `<li data-valor="" ${actual ? "" : 'aria-selected="true"'}>Todos</li>`}
          ${clientes.map(c => `<li data-valor="${c.did}" ${String(c.did) === String(actual) ? 'aria-selected="true"' : ""}>${tituloTexto(nombreCliente(c))}</li>`).join("")}
        </ul>
      </div>
    `;
    crearComboGenerico("combo-cliente-envios-listado", (valor)=>{ stateEnviosListado.cliente = valor; cargarEnviosListado(true); });
  }

  // Resetea a su default el combo cuyo <li> por defecto es siempre el
  // PRIMERO del <ul> (todos los de este listado se arman así) — sin
  // pasar por el registro de crearComboGenerico, para no disparar una
  // recarga por cada combo reseteado (ver reiniciarFiltrosEnviosListado).
  function resetearComboDom(id){
    const cont = document.getElementById(id);
    if(!cont) return;
    const btn = cont.querySelector(".combo-filtro-btn");
    const lista = cont.querySelector(".combo-filtro-lista");
    const primero = lista.querySelector("li");
    if(!primero) return;
    [...lista.querySelectorAll("li")].forEach(li => li.setAttribute("aria-selected", String(li === primero)));
    btn.textContent = primero.textContent;
  }

  // Pedido 2026-11-26: cada vez que se ENTRA a la pantalla (no solo la
  // primera vez, a diferencia de inicializarFiltrosEnviosListado) los
  // filtros vuelven a su estado inicial — antes quedaban pegados de la
  // visita anterior ("filtro, me voy a otra sección, vuelvo, y sigue
  // filtrado"). Reset directo del DOM (no vía el registro de combos) para
  // no disparar 7 recargas encadenadas — una sola al final.
  export async function reiniciarFiltrosEnviosListado(){
    stateEnviosListado.busqueda = ""; stateEnviosListado.estado = ""; stateEnviosListado.origen = "";
    stateEnviosListado.tamano = ""; stateEnviosListado.localidad = ""; stateEnviosListado.cordon = "";
    stateEnviosListado.repartidor = "";
    stateEnviosListado.desde = lunesDeSemana(fechaART(0)); stateEnviosListado.hasta = fechaART(0);
    stateEnviosListado.paginaActual = 0; stateEnviosListado.tamanoPagina = 10;
    const buscador = document.getElementById("buscar-envios-listado");
    if(buscador) buscador.value = "";
    document.getElementById("envios-listado-desde").value = stateEnviosListado.desde;
    document.getElementById("envios-listado-hasta").value = stateEnviosListado.hasta;
    [
      "combo-estado-envios-listado", "combo-origen-envios-listado", "combo-tamano-filtro-envios-listado",
      "combo-localidad-envios-listado", "combo-zona-envios-listado", "combo-repartidor-envios-listado",
      "combo-tamano-envios-listado",
    ].forEach(resetearComboDom);
    repoblarComboClienteEnviosListado(await resolverClientesFiltroEnvios());
  }

  let filtrosEnviosListadoListos = false;
  export async function inicializarFiltrosEnviosListado(){
    if(filtrosEnviosListadoListos) return;
    filtrosEnviosListadoListos = true;

    // Pedido 2026-11-25: para un usuario cliente, el combo de filtro de
    // Tamaño pasa de 3 opciones (Pequeño/Mediano/Grande) a 2 (Pequeños/
    // Grandes) — hay que reconstruir el contenedor entero y volver a
    // llamar crearComboGenerico (mismo patrón que repoblarComboPeriodo en
    // Liquidación Clientes): los listeners de los <li> se enganchan una
    // sola vez al crearse, así que un <li> nuevo pegado con innerHTML no
    // tendría click funcionando si no se recrea el combo entero.
    if(esUsuarioCliente()){
      document.getElementById("combo-tamano-filtro-envios-listado").outerHTML = `
        <div class="combo-filtro" id="combo-tamano-filtro-envios-listado">
          <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">Todos</button>
          <ul class="combo-filtro-lista" role="listbox" hidden>
            <li data-valor="" aria-selected="true">Todos</li>
            <li data-valor="Pequeño">Pequeños</li>
            <li data-valor="Grandes">Grandes</li>
          </ul>
        </div>
      `;
      crearComboGenerico("combo-tamano-filtro-envios-listado", (valor)=>{ stateEnviosListado.tamano = valor; cargarEnviosListado(true); });
    }

    repoblarComboClienteEnviosListado(await resolverClientesFiltroEnvios());

    agregarOpcionesCombo("combo-localidad-envios-listado", abmLocalidades.obtenerActivos().map(n => ({ valor: n, texto: tituloTexto(n) })));
    crearComboGenerico("combo-localidad-envios-listado", (valor)=>{ stateEnviosListado.localidad = valor; cargarEnviosListado(true); });

    // Pedido 2026-11-23: este combo estaba mal conectado desde siempre —
    // filtraba contra abmZonas (CABA/ZONA NORTE/ZONA SUR…, la asignación
    // geográfica de repartidores) comparando `ilike` contra envios.zona
    // (crudo de Lightdata: CABA/ZONA 1/ZONA 2/ZONA 3) — dos vocabularios
    // que nunca podían matchear. Ahora filtra por Cordón (envios.cordon_id,
    // ya resuelto por Localidad+CP) con un combo de opciones fijas.
    await abmCordones.cargar();
    // "Sin clasificar" (pedido 2026-11-23) para poder encontrar desde acá
    // mismo los envíos que todavía no tienen cordón resuelto, sin tener
    // que cruzar a mano con la pantalla de Localidades.
    agregarOpcionesCombo("combo-zona-envios-listado", [
      { valor: "sin_clasificar", texto: "Sin clasificar" },
      ...abmCordones.obtenerActivosConId(),
    ]);
    crearComboGenerico("combo-zona-envios-listado", (valor)=>{ stateEnviosListado.cordon = valor; cargarEnviosListado(true); });

    // Repartidor: mismo roster que ya resuelve el nombre en la grilla
    // (cargarNombresPorLightdataId) — filtra por chofer_lightdata_id, no
    // por nombre (regla de siempre: cruzar por ID de Lightdata).
    await cargarNombresPorLightdataId();
    const repartidores = Object.entries(stateFallidos.nombresPorLightdataId)
      .map(([id, nombre]) => ({ valor: id, texto: nombre }))
      .sort((a, b) => a.texto.localeCompare(b.texto));
    agregarOpcionesCombo("combo-repartidor-envios-listado", repartidores);
    crearComboGenerico("combo-repartidor-envios-listado", (valor)=>{ stateEnviosListado.repartidor = valor; cargarEnviosListado(true); });
  }
