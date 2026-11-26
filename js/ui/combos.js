// Combos, popovers y multiselect genericos (lista desplegable, panel de
// filtros, checkboxes) usados en toda la app.
// Viene de index.html (Etapa 1 de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.

// Registro de combos creados por crearComboGenerico (definida más abajo),
// para poder resetearlos todos de una vez desde el botón "Limpiar
// filtros" del popover que los contiene (ver crearPopoverGenerico) —
// global para cualquier pantalla, no una solución puntual de un módulo.
// OJO: tiene que declararse ACÁ, antes que cualquier módulo llame a
// crearComboGenerico (Fallidos lo hace primero en el script) — un
// `const` no se "hoistea" con valor como una función declarada, así que
// declararlo más abajo revienta con "Cannot access before initialization"
// apenas corre la primera llamada (bug real, visto en pruebas).
const registroCombos = new Map();

// A partir de cuántas opciones un combo se arma con buscador adentro
// (pedido 2026-11-18, global para toda la app: con el roster de
// repartidores creciendo, elegir uno de una lista larga sin poder
// escribir para filtrar era impracticable). Automático: ningún módulo
// tiene que pedirlo a propósito, cualquier combo con más opciones que
// esto lo tiene solo. Declarado ACÁ arriba por la misma razón que
// registroCombos (ver regla 13 en reglas_de_negocio.md).
const UMBRAL_BUSCADOR_COMBO = 8;

export function agregarOpcionesCombo(contId, opciones){
  const ul = document.querySelector(`#${contId} .combo-filtro-lista`);
  opciones.forEach(o=>{
    const li = document.createElement("li");
    li.dataset.valor = o.valor;
    li.textContent = o.texto;
    ul.appendChild(li);
  });
}

// ----- Combo/popover con lista o panel propio (ver regla en
// reglas_de_negocio.md sección 21/22) — UN SOLO menú flotante puede
// estar abierto a la vez, sea un combo de opción única o un popover
// "Filtrar"/"Columnas" con varios controles adentro. Abrir cualquiera
// de ellos cierra el que estuviera abierto antes a través de este mismo
// singleton (bug real 2026-11-15: cada popover tenía su propia variable
// "yaAbierto" aislada, así que abrir "Columnas" no cerraba "Filtrar" —
// quedaban los dos paneles dibujados uno encima del otro, con un
// "doble borde" donde se pisaban). Cualquier combo o popover flotante
// nuevo DEBE crearse con crearComboGenerico o crearPopoverGenerico, no
// con su propio hidden/aria-expanded aislado.
// Pila (no un solo valor) porque un combo puede vivir ANIDADO adentro
// de un popover ya abierto (p.ej. "Rendimiento"/"Estado" adentro de
// "Filtrar", en Choferes en ruta) — bug real 2026-11-15: con un solo
// "esto es lo único abierto", abrir el combo de adentro cerraba el
// popover de afuera (que lo contiene), así que el combo quedaba oculto
// apenas se abría — se veía como "el desplegable no funciona". Al abrir
// algo nuevo, solo se cierra lo que NO sea un antepasado de lo nuevo.
const pilaFlotantes = []; // [{ cont, el, cerrar }], del más externo al más interno
function cerrarComboGlobal(){
  while(pilaFlotantes.length) pilaFlotantes.pop().cerrar();
}
function cerrarHastaAntepasadosDe(cont){
  while(pilaFlotantes.length && !pilaFlotantes[pilaFlotantes.length - 1].cont.contains(cont)){
    pilaFlotantes.pop().cerrar();
  }
}
function estaAbierto(el){
  return pilaFlotantes.some(x => x.el === el);
}
function abrirEnPila(cont, el, cerrar){
  cerrarHastaAntepasadosDe(cont);
  pilaFlotantes.push({ cont, el, cerrar });
}
function cerrarDeLaPila(el){
  const i = pilaFlotantes.findIndex(x => x.el === el);
  if(i !== -1) pilaFlotantes.splice(i, 1);
}
document.addEventListener("click", (e)=>{
  if(pilaFlotantes.length && !e.target.closest(".combo-filtro")) cerrarComboGlobal();
});

// Si no entra hacia abajo en lo que queda de pantalla, abre hacia arriba
// (bug real 2026-11-15: siempre abría hacia abajo, cortando la pantalla
// cuando no había espacio). Se mide ANTES de mostrar la lista, con su
// alto ya conocido (max-height fijo en CSS).
function posicionarListaCombo(btn, lista){
  const rectBtn = btn.getBoundingClientRect();
  const altoLista = lista.scrollHeight || 220;
  const espacioAbajo = window.innerHeight - rectBtn.bottom;
  lista.classList.toggle("abre-arriba", espacioAbajo < altoLista + 12 && rectBtn.top > altoLista);
}

// El combo tiene que poder manejarse igual que un <select> nativo:
// click en una opción CIERRA la lista siempre (sin excepción), y las
// flechas ↑/↓ recorren las opciones, Enter confirma, Escape cierra —
// pedido 2026-11-15, "es una regla que no debes pasar". `seleccionar()`
// es el ÚNICO camino para elegir un valor (lo usan tanto el click como
// el teclado), así que cerrar-al-elegir no puede quedar implementado en
// un solo lugar sí y en el otro no.
export function crearComboGenerico(contenedorId, onSelect){
  const cont = document.getElementById(contenedorId);
  const btn = cont.querySelector(".combo-filtro-btn");
  const lista = cont.querySelector(".combo-filtro-lista");
  const items = () => Array.from(lista.querySelectorAll("li"));
  // El default es el <li aria-selected="true"> tal como está en el HTML
  // al crearse el combo (antes de que el usuario elija nada) — se fija acá
  // porque una vez que se selecciona otra cosa, aria-selected se mueve.
  const liPorDefecto = items().find(li => li.getAttribute("aria-selected") === "true") || items()[0];

  // Buscador opcional adentro del combo: filtra los <li> por texto, sin
  // tocar items() (que sigue viendo TODOS, para selección/registro/reset)
  // — itemsVisibles() es la que usa la navegación por teclado.
  let buscador = null;
  if(items().length > UMBRAL_BUSCADOR_COMBO){
    buscador = document.createElement("input");
    buscador.type = "text";
    buscador.className = "buscador-combo-lista";
    buscador.placeholder = "Buscar…";
    buscador.addEventListener("click", (e)=> e.stopPropagation());
    buscador.addEventListener("input", ()=>{
      const q = buscador.value.trim().toLowerCase();
      items().forEach(li => { li.hidden = q !== "" && !li.textContent.toLowerCase().includes(q); });
    });
    lista.insertBefore(buscador, lista.firstChild);
  }
  const itemsVisibles = () => items().filter(li => !li.hidden);

  function cerrar(){
    lista.hidden = true;
    lista.classList.remove("abre-arriba");
    btn.setAttribute("aria-expanded", "false");
    items().forEach(li => li.removeAttribute("tabindex"));
  }
  function abrir(){
    lista.hidden = false;
    if(buscador){ buscador.value = ""; items().forEach(li => { li.hidden = false; }); }
    posicionarListaCombo(btn, lista);
    btn.setAttribute("aria-expanded", "true");
    abrirEnPila(cont, lista, cerrar);
    if(buscador){
      buscador.focus();
    } else {
      const activa = items().find(li => li.getAttribute("aria-selected") === "true") || items()[0];
      items().forEach(li => li.tabIndex = -1);
      if(activa){ activa.tabIndex = 0; activa.focus(); }
    }
  }
  function seleccionar(li){
    if(!li) return;
    btn.textContent = li.textContent;
    items().forEach(x => x.setAttribute("aria-selected", String(x === li)));
    cerrar();
    cerrarDeLaPila(lista);
    btn.focus();
    onSelect(li.dataset.valor, li);
  }

  btn.addEventListener("click", (e)=>{
    e.stopPropagation();
    const yaAbierta = estaAbierto(lista);
    if(yaAbierta){ cerrar(); cerrarDeLaPila(lista); }
    else abrir();
  });
  btn.addEventListener("keydown", (e)=>{
    if(["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)){
      e.preventDefault();
      if(lista.hidden) abrir();
    }
  });
  if(buscador){
    buscador.addEventListener("keydown", (e)=>{
      const lis = itemsVisibles();
      if(e.key === "ArrowDown"){ e.preventDefault(); if(lis[0]){ lis[0].tabIndex = 0; lis[0].focus(); } }
      else if(e.key === "Enter"){ e.preventDefault(); if(lis[0]) seleccionar(lis[0]); }
      else if(e.key === "Escape"){ e.preventDefault(); cerrar(); cerrarDeLaPila(lista); btn.focus(); }
    });
  }
  items().forEach(li=>{
    li.addEventListener("click", (e)=>{ e.stopPropagation(); seleccionar(li); });
    li.addEventListener("keydown", (e)=>{
      const lis = itemsVisibles();
      const i = lis.indexOf(li);
      if(e.key === "ArrowDown"){
        e.preventDefault();
        const sig = lis[Math.min(i + 1, lis.length - 1)];
        if(sig){ sig.tabIndex = 0; li.tabIndex = -1; sig.focus(); }
      }
      else if(e.key === "ArrowUp"){
        e.preventDefault();
        if(i === 0 && buscador){ li.tabIndex = -1; buscador.focus(); }
        else { const ant = lis[Math.max(i - 1, 0)]; if(ant){ ant.tabIndex = 0; li.tabIndex = -1; ant.focus(); } }
      }
      else if(e.key === "Home"){ e.preventDefault(); const primero = lis[0]; if(primero){ primero.tabIndex = 0; li.tabIndex = -1; primero.focus(); } }
      else if(e.key === "End"){ e.preventDefault(); const ultimo = lis[lis.length - 1]; if(ultimo){ ultimo.tabIndex = 0; li.tabIndex = -1; ultimo.focus(); } }
      else if(e.key === "Enter" || e.key === " "){ e.preventDefault(); seleccionar(li); }
      else if(e.key === "Escape"){ e.preventDefault(); cerrar(); cerrarDeLaPila(lista); btn.focus(); }
    });
  });

  registroCombos.set(contenedorId, {
    estaEnDefault: () => (items().find(li => li.getAttribute("aria-selected") === "true") || items()[0]) === liPorDefecto,
    resetear: () => seleccionar(liPorDefecto),
  });
}

// Pedido 2026-11-26: resetear a su default un combo puntual por id (sin
// pasar por el botón "Limpiar filtros" de un popover) — lo usa cada
// pantalla con filtros para volver a su estado inicial cada vez que se
// entra a la sección, en vez de arrastrar el filtro de la visita
// anterior (bug real: "entro, filtro, me voy y vuelvo, y sigue filtrado").
export function resetearCombo(id){
  const combo = registroCombos.get(id);
  if(combo && !combo.estaEnDefault()) combo.resetear();
}

// Popover genérico (botón "Filtrar" / "Columnas" + panel con controles
// adentro, p.ej. #popover-filtros-ruta, #popover-filtros-asistencia,
// #popover-columnas-asistencia) — mismo singleton que crearComboGenerico.
export function crearPopoverGenerico(contenedorId){
  const cont = document.getElementById(contenedorId);
  const btn = cont.querySelector(".btn-filtrar");
  const panel = cont.querySelector(".panel-filtros-ruta");
  function cerrar(){ panel.hidden = true; panel.classList.remove("abre-arriba"); btn.setAttribute("aria-expanded", "false"); }
  btn.addEventListener("click", (e)=>{
    e.stopPropagation();
    const yaAbierto = estaAbierto(panel);
    if(yaAbierto){ cerrar(); cerrarDeLaPila(panel); }
    else {
      panel.hidden = false;
      posicionarListaCombo(btn, panel);
      btn.setAttribute("aria-expanded", "true");
      abrirEnPila(cont, panel, cerrar);
    }
  });
  agregarLimpiarFiltros(panel);
}

// "Limpiar filtros" (pedido 2026-11-18): un único botón global que
// resetea TODOS los combos de un panel-filtros-ruta a su valor por
// defecto de una sola vez. Se agrega solo, solamente si el panel tiene
// combos adentro (un panel de "Columnas", por ejemplo, no) — nada que
// configurar por módulo. Los ids se leen al toque (no al crearse el
// popover) porque los combos de adentro suelen registrarse DESPUÉS de
// crearPopoverGenerico (ver orden real en, p.ej., Fallidos).
function agregarLimpiarFiltros(panel){
  const idsCombo = Array.from(panel.querySelectorAll(".combo-filtro[id]")).map(el => el.id);
  if(!idsCombo.length) return;
  const btnLimpiar = document.createElement("button");
  btnLimpiar.type = "button";
  btnLimpiar.className = "btn-limpiar-filtros";
  btnLimpiar.innerHTML = '<i data-lucide="x"></i>Limpiar filtros';
  btnLimpiar.addEventListener("click", (e)=>{
    e.stopPropagation();
    idsCombo.forEach(id=>{
      const combo = registroCombos.get(id);
      if(combo && !combo.estaEnDefault()) combo.resetear();
    });
  });
  panel.insertBefore(btnLimpiar, panel.firstChild);
  lucide.createIcons();
}

// Campo de selección múltiple para el modal ABM (p.ej. "Localidades" de
// un chofer: puede atender varias) — mismo singleton que los combos y
// popovers, pero con checkboxes en vez de una lista de opción única.
export function crearMultiSelectGenerico(contenedorId){
  const cont = document.getElementById(contenedorId);
  const btn = cont.querySelector(".combo-filtro-btn");
  const panel = cont.querySelector(".panel-filtros-ruta");
  const buscador = panel.querySelector(".buscador-multiselect");
  const sinResultados = panel.querySelector(".sin-resultados-multiselect");
  const opciones = Array.from(panel.querySelectorAll(".check-columna"));
  function actualizarTexto(){
    const marcados = Array.from(panel.querySelectorAll("input:checked")).map(i => i.value);
    cont.dataset.valorActual = marcados.join(", ");
    btn.textContent = marcados.length ? marcados.join(", ") : "Elegir…";
  }
  function cerrar(){
    panel.hidden = true;
    panel.classList.remove("abre-arriba");
    btn.setAttribute("aria-expanded", "false");
    if(buscador){ buscador.value = ""; filtrar(""); }
  }
  // Buscador de texto dentro del panel — un multiselect no puede usar el
  // mismo type-ahead por teclado de los combos de opción única (acá
  // cada tecla tiene que poder togglear un checkbox con Espacio, no
  // saltar de opción), así que la forma de "buscar con el teclado" es
  // este campo de texto, enfocado automáticamente al abrir.
  function filtrar(texto){
    const q = texto.trim().toLowerCase();
    let visibles = 0;
    opciones.forEach(op=>{
      const coincide = !q || (op.dataset.texto || "").includes(q);
      op.hidden = !coincide;
      if(coincide) visibles++;
    });
    if(sinResultados) sinResultados.hidden = visibles > 0;
  }
  btn.addEventListener("click", (e)=>{
    e.stopPropagation();
    const yaAbierto = estaAbierto(panel);
    if(yaAbierto){ cerrar(); cerrarDeLaPila(panel); }
    else {
      panel.hidden = false;
      posicionarListaCombo(btn, panel);
      btn.setAttribute("aria-expanded", "true");
      abrirEnPila(cont, panel, cerrar);
      if(buscador) buscador.focus();
    }
  });
  panel.querySelectorAll("input[type=checkbox]").forEach(input => input.addEventListener("change", actualizarTexto));
  if(buscador){
    buscador.addEventListener("click", (e) => e.stopPropagation());
    buscador.addEventListener("input", (e) => filtrar(e.target.value));
    buscador.addEventListener("keydown", (e) => { if(e.key === "Escape"){ cerrar(); cerrarDeLaPila(panel); btn.focus(); } });
  }
}
