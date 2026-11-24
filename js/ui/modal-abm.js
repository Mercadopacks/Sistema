// Modal genérico de alta/edición para los ABMs de Configuración.
// Viene de index.html (Etapa 2 de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.
import { crearComboGenerico, crearMultiSelectGenerico } from "./combos.js";

  // ----- Modal genérico de alta/edición (ver reglas_de_negocio.md sección 0) -----
  let modalAbmOnGuardar = null;
  const comboInstanciasModal = [];

  // Lee el estado actual de todos los campos del modal abierto (inputs +
  // combos), en el mismo formato que recibe onGuardar — se usa tanto para
  // guardar como para evaluar `mostrarSi` de cada campo en vivo.
  function leerValoresModalAbm(){
    const datos = {};
    document.querySelectorAll("#modal-abm-campos .cel-input").forEach(input=>{
      datos[input.dataset.campo] = input.type === "checkbox" ? input.checked : (input.value || null);
    });
    comboInstanciasModal.forEach(contId=>{
      const campo = contId.replace("modal-campo-", "");
      datos[campo] = document.getElementById(contId).dataset.valorActual || null;
    });
    return datos;
  }

  // `opciones.grid` (pedido 2026-11-19): algunos formularios con muchos
  // campos quedaban como una lista larga hacia abajo con mucho scroll —
  // en modo grilla los campos van de a 2-3 por fila (`c.icono` para el
  // ícono del título, `c.span` para que uno ocupe todo el ancho, ej. un
  // multiselect u observaciones). Opt-in: sin `opciones.grid`, todo se ve
  // exactamente igual que siempre (ningún otro ABM del sistema lo usa
  // todavía, así que no hay riesgo de romper nada existente).
  export function abrirModalAbm(titulo, campos, valores, onGuardar, opciones){
    opciones = opciones || {};
    document.getElementById("modal-abm-titulo").textContent = titulo;
    const cont = document.getElementById("modal-abm-campos");
    cont.classList.toggle("modal-abm-grid", !!opciones.grid);
    document.querySelector("#modal-abm .modal-card").classList.toggle("modal-abm-card-ancha", !!opciones.grid);
    comboInstanciasModal.length = 0;

    // Campos con `mostrarSi(valoresActuales)` quedan ocultos hasta que esa
    // condición se cumpla (ej. "Precio a descontar" solo si el Estatus
    // elegido es "Descontar al chofer") — se reevalúa en cada cambio, ver
    // actualizarVisibilidadCampos() más abajo.
    function actualizarVisibilidadCampos(){
      const actuales = leerValoresModalAbm();
      campos.forEach(c=>{
        if(!c.mostrarSi) return;
        const wrap = cont.querySelector(`[data-campo-wrap="${c.clave}"]`);
        if(wrap) wrap.hidden = !c.mostrarSi(actuales);
      });
    }

    const labelConIcono = c => c.icono ? `<span class="label-con-icono"><i data-lucide="${c.icono}"></i>${c.label}</span>` : c.label;
    const claseWrap = c => c.span ? `data-campo-wrap="${c.clave}" class="campo-span-completo"` : `data-campo-wrap="${c.clave}"`;

    cont.innerHTML = campos.map(c => {
      const val = (valores && valores[c.clave] != null) ? valores[c.clave] : "";
      if(c.tipo === "checkbox"){
        return `<div ${claseWrap(c)}><label class="modal-abm-check"><input type="checkbox" class="cel-input" data-campo="${c.clave}" ${val ? "checked" : ""} /> ${labelConIcono(c)}</label></div>`;
      }
      if(c.tipo === "select"){
        // Cada opción puede ser un string simple ("AUTO") o un par
        // {valor, texto} cuando el texto a mostrar no puede ser el mismo
        // dato que se guarda (p.ej. "— Sin turno —" para turno = "").
        const opciones = (c.opciones || []).map(o =>{
          const valor = (o && typeof o === "object") ? o.valor : o;
          const texto = (o && typeof o === "object") ? o.texto : o;
          return `<li data-valor="${valor}" aria-selected="${String(valor) === String(val)}">${texto}</li>`;
        }).join("");
        const actual = (c.opciones || []).find(o => String((o && typeof o === "object") ? o.valor : o) === String(val));
        const textoActual = actual ? ((actual && typeof actual === "object") ? actual.texto : actual) : (val || "Elegir…");
        return `<div ${claseWrap(c)}><div class="modal-abm-label">${labelConIcono(c)}
          <div class="combo-filtro" id="modal-campo-${c.clave}" data-valor-actual="${val || ""}">
            <button type="button" class="combo-filtro-btn" aria-haspopup="listbox" aria-expanded="false">${textoActual}</button>
            <ul class="combo-filtro-lista" role="listbox" hidden>${opciones}</ul>
          </div>
        </div></div>`;
      }
      if(c.tipo === "multiselect"){
        const seleccionados = new Set(String(val || "").split(",").map(s => s.trim()).filter(Boolean));
        const opciones = (c.opciones || []).map(o => `
          <label class="check-columna" data-texto="${o.toLowerCase().replace(/"/g, "&quot;")}"><input type="checkbox" value="${o}" ${seleccionados.has(o) ? "checked" : ""}/> ${o}</label>
        `).join("");
        const textoActual = seleccionados.size ? [...seleccionados].join(", ") : "Elegir…";
        return `<div ${claseWrap(c)}><div class="modal-abm-label">${labelConIcono(c)}
          <div class="combo-filtro" id="modal-campo-${c.clave}" data-valor-actual="${[...seleccionados].join(", ")}">
            <button type="button" class="combo-filtro-btn" aria-haspopup="true" aria-expanded="false">${textoActual}</button>
            <div class="panel-filtros-ruta panel-multiselect" hidden>
              <input type="text" class="buscador-multiselect" placeholder="Buscar…" />
              <div class="sin-resultados-multiselect sin-datos" hidden>Sin resultados.</div>
              <div class="lista-multiselect">${opciones || '<span class="sin-datos">Sin localidades cargadas en Administración.</span>'}</div>
            </div>
          </div>
        </div></div>`;
      }
      const tipoInput = c.tipo === "time" ? "time" : (c.tipo === "number" ? "number" : "text");
      return `<div ${claseWrap(c)}><label class="modal-abm-label">${labelConIcono(c)}
        <input type="${tipoInput}" class="cel-input" data-campo="${c.clave}" value="${String(val).replace(/"/g, "&quot;")}" />
      </label></div>`;
    }).join("");
    lucide.createIcons();

    campos.filter(c => c.tipo === "select").forEach(c=>{
      const contId = `modal-campo-${c.clave}`;
      crearComboGenerico(contId, (valor)=>{
        document.getElementById(contId).dataset.valorActual = valor;
        actualizarVisibilidadCampos();
      });
      comboInstanciasModal.push(contId);
    });
    campos.filter(c => c.tipo === "multiselect").forEach(c=>{
      const contId = `modal-campo-${c.clave}`;
      crearMultiSelectGenerico(contId);
      comboInstanciasModal.push(contId);
    });
    cont.querySelectorAll(".cel-input").forEach(input=>{
      input.addEventListener("input", actualizarVisibilidadCampos);
    });
    actualizarVisibilidadCampos();

    document.getElementById("modal-abm").hidden = false;
    modalAbmOnGuardar = onGuardar;
  }

  document.getElementById("modal-abm-cerrar").addEventListener("click", ()=>{
    document.getElementById("modal-abm").hidden = true;
  });
  document.getElementById("modal-abm-guardar").addEventListener("click", async ()=>{
    const datos = leerValoresModalAbm();
    const btnGuardar = document.getElementById("modal-abm-guardar");
    // Indicador de espera genérico (pedido 2026-11-16): algunos onGuardar
    // tardan de verdad (ej. "Agregar usuario" llama a una Edge Function
    // que crea la cuenta de Auth) y sin esto no había ninguna señal de que
    // el click hizo algo. Se deshabilita el botón para evitar un doble
    // click mientras tanto.
    const textoOriginal = btnGuardar.textContent;
    btnGuardar.disabled = true;
    btnGuardar.textContent = "Guardando…";
    let cerrar = true;
    try {
      // Un onGuardar que devuelve `false` (ej. una validación que falló, o
      // un error del servidor) deja el modal abierto con los datos tal
      // cual los escribió el usuario, en vez de cerrarlo y obligarlo a
      // cargar todo de nuevo — bug real reportado 2026-11-16. Cualquier
      // otro valor de retorno (incluido `undefined`, lo más común) sigue
      // cerrando como siempre.
      if(modalAbmOnGuardar) cerrar = (await modalAbmOnGuardar(datos)) !== false;
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = textoOriginal;
    }
    if(cerrar) document.getElementById("modal-abm").hidden = true;
  });
