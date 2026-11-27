// ABM de Localidad con CP/Cordon/Zona por FK.
// Viene de index.html (Etapa 2 de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { tituloTexto } from "../core/formato.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";
import { abmCordones } from "./abm-simple.js";
import { pendientesConfigState, actualizarIconoPendientesConfig } from "./pendientes-config.js";
import { crearComboGenerico, crearPopoverGenerico, agregarOpcionesCombo } from "../ui/combos.js";

  // ----- ABM de Localidad con CP/Cordón/Zona por FK (pedido 2026-11-20,
  // revertido parcialmente el 2026-11-21: la Zona vuelve a ser su propio
  // ABM parametrizable — acá solo se la referencia por FK, no se la edita
  // como texto libre). Cordón también es FK al ABM de Cordones.
  // Pedido 2026-11-23: antes esta pantalla editaba parametros_localidades
  // directo (1 cordón por nombre de localidad) — se separó en una tabla
  // hija (parametros_localidad_cps) porque una misma localidad puede caer
  // en MÁS de un Cordón según el CP (confirmado con datos reales: 8
  // localidades de Base_Zonas tienen CPs en cordones distintos — ej.
  // "Buenos Aires" tiene CPs que son CABA, otros GBA1). Acá se lista plano
  // (sin agrupar/expandir, a pedido) 1 fila por combinación Localidad+CP.
  function crearAbmLocalidades(){
    let datosCps = [];        // parametros_localidad_cps + nombre de localidad embebido
    let localidadesPorNombre = {}; // nombre normalizado -> { id, nombre } (para buscar/crear localidad al guardar)
    let busqueda = "";
    // Pedido 2026-11-27: el botón toggle "Ver solo pendientes" se
    // reemplaza por el popover "Filtrar" estándar (mismo estilo que el
    // resto de Configuración) — "sin-clasificar" es la misma funcionalidad
    // de antes (cordon_id == null), + un valor por cada cordón real para
    // poder filtrar por uno puntual, cosa que el toggle no permitía.
    let filtroCordon = "";
    let cargado = false;
    let comboCordonPoblado = false;

    function normalizarNombre(s){
      return (s || "").trim().toUpperCase();
    }

    async function cargar(forzar){
      await abmCordones.cargar();
      if(!comboCordonPoblado){
        // Las opciones del combo "Cordón" dependen del catálogo de
        // Cordones (recién disponible después de abmCordones.cargar()) —
        // mismo patrón que el combo de Zona en liquidacion-vista.js:
        // agregarOpcionesCombo SIEMPRE antes de crearComboGenerico.
        agregarOpcionesCombo("combo-cordon-admin-localidades", abmCordones.obtenerActivosConId());
        comboCordonPoblado = true;
      }
      if(cargado && !forzar) return;
      const [{ data: cps, error: errCps }, { data: localidades, error: errLoc }] = await Promise.all([
        sb.from("parametros_localidad_cps").select("id,cp,cordon_id,localidad_id,parametros_localidades(nombre)").order("cp"),
        sb.from("parametros_localidades").select("id,nombre").order("nombre"),
      ]);
      if(errCps){ console.error("Error cargando parametros_localidad_cps:", errCps); return; }
      if(errLoc){ console.error("Error cargando parametros_localidades:", errLoc); return; }
      datosCps = cps || [];
      localidadesPorNombre = {};
      (localidades || []).forEach(l => { localidadesPorNombre[normalizarNombre(l.nombre)] = l; });
      cargado = true;
      render();
      actualizarAvisoLocalidadesPendientes();
    }

    function nombreDe(fila){
      const l = fila.parametros_localidades;
      return (Array.isArray(l) ? l[0] : l)?.nombre || "—";
    }
    function labelCordon(id){
      const c = (abmCordones.obtenerActivosConId() || []).find(x => x.valor === id);
      return c ? c.texto : null;
    }

    function render(){
      let filas = datosCps;
      if(filtroCordon === "sin-clasificar") filas = filas.filter(f => f.cordon_id == null);
      else if(filtroCordon) filas = filas.filter(f => String(f.cordon_id) === filtroCordon);
      if(busqueda) filas = filas.filter(f =>
        nombreDe(f).toLowerCase().includes(busqueda) ||
        (f.cp || "").toLowerCase().includes(busqueda)
      );
      const tbody = document.getElementById("tabla-admin-localidades");
      if(!filas.length){
        tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">${filtroCordon ? "Sin resultados para este filtro." : "Sin localidades cargadas."}</td></tr>`;
        return;
      }
      tbody.innerHTML = filas.map(f => {
        const cordon = labelCordon(f.cordon_id);
        return `
        <tr data-id="${f.id}">
          <td>${tituloTexto(nombreDe(f))}</td>
          <td>${f.cp || "—"}</td>
          <td>${cordon || '<span class="badge-pendiente-cordon">Sin clasificar</span>'}</td>
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

    function campos(valores){
      return [
        { clave: "nombre", label: "Localidad", tipo: "texto" },
        { clave: "cp", label: "CP", tipo: "texto" },
        { clave: "cordon_id", label: "Cordón", tipo: "select", opciones: abmCordones.obtenerActivosConId() },
      ];
    }

    // Busca la localidad maestra por nombre (normalizado) o la crea si no
    // existe todavía — mismo criterio que el trigger fn_resolver_cordon_envio
    // del lado de la base, pero para el alta manual desde esta pantalla.
    async function resolverLocalidadId(nombre){
      const clave = normalizarNombre(nombre);
      const existente = localidadesPorNombre[clave];
      if(existente) return existente.id;
      const { data, error } = await sb.from("parametros_localidades").insert({ nombre: nombre.trim(), activo: true }).select().single();
      if(error){ return null; }
      localidadesPorNombre[clave] = data;
      return data.id;
    }

    function abrirAlta(){
      abrirModalAbm("Agregar localidad", campos(), {}, async (vals)=>{
        if(!vals.nombre || !vals.cp){ await mostrarAviso("Localidad y CP son obligatorios."); return false; }
        const localidadId = await resolverLocalidadId(vals.nombre);
        if(!localidadId){ await mostrarAviso("No se pudo guardar la localidad."); return false; }
        const payload = { localidad_id: localidadId, cp: vals.cp.trim(), cordon_id: vals.cordon_id ? Number(vals.cordon_id) : null };
        const { data, error } = await sb.from("parametros_localidad_cps").insert(payload).select("id,cp,cordon_id,localidad_id,parametros_localidades(nombre)").single();
        if(error){ await mostrarAviso("No se pudo guardar (¿ya existe esa Localidad+CP?)."); return false; }
        datosCps.push(data);
        render();
        actualizarAvisoLocalidadesPendientes();
      });
    }

    function abrirEdicion(id){
      const fila = datosCps.find(f => f.id === id);
      if(!fila) return;
      abrirModalAbm("Editar localidad", campos(), { nombre: nombreDe(fila), cp: fila.cp, cordon_id: fila.cordon_id }, async (vals)=>{
        if(!vals.nombre || !vals.cp){ await mostrarAviso("Localidad y CP son obligatorios."); return false; }
        const localidadId = await resolverLocalidadId(vals.nombre);
        if(!localidadId){ await mostrarAviso("No se pudo guardar la localidad."); return false; }
        const payload = { localidad_id: localidadId, cp: vals.cp.trim(), cordon_id: vals.cordon_id ? Number(vals.cordon_id) : null };
        const { error } = await sb.from("parametros_localidad_cps").update(payload).eq("id", id);
        if(error){ await mostrarAviso("No se pudo guardar."); return false; }
        Object.assign(fila, payload, { parametros_localidades: { nombre: vals.nombre.trim() } });
        render();
        actualizarAvisoLocalidadesPendientes();
      });
    }

    async function borrar(id){
      if(!(await mostrarConfirmacion("¿Borrar este registro? No se puede deshacer."))) return;
      const { error } = await sb.from("parametros_localidad_cps").delete().eq("id", id);
      if(error){ console.error(error); await mostrarAviso("No se pudo borrar."); return; }
      datosCps = datosCps.filter(f => f.id !== id);
      render();
      actualizarAvisoLocalidadesPendientes();
    }

    document.getElementById("buscar-admin-localidades").addEventListener("input", (e)=>{
      busqueda = e.target.value.toLowerCase();
      render();
    });
    crearPopoverGenerico("popover-filtros-admin-localidades");
    crearComboGenerico("combo-cordon-admin-localidades", (valor)=>{ filtroCordon = valor; render(); });
    document.getElementById("btn-agregar-localidad").addEventListener("click", abrirAlta);
    document.getElementById("btn-resincronizar-cordones").addEventListener("click", async (e)=>{
      const btn = e.currentTarget;
      const textoOriginal = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = "Resincronizando…";
      try {
        const { data, error } = await sb.rpc("resincronizar_cordones_envios");
        if(error){ console.error("Error resincronizando cordones:", error); await mostrarAviso("No se pudo resincronizar."); return; }
        await cargar(true);
        await mostrarAviso(`Listo: ${data.actualizados} envío${data.actualizados === 1 ? "" : "s"} actualizado${data.actualizados === 1 ? "" : "s"}, ${data.pendientes_creados} combinación${data.pendientes_creados === 1 ? "" : "es"} nueva${data.pendientes_creados === 1 ? "" : "s"} encolada${data.pendientes_creados === 1 ? "" : "s"} para clasificar.`);
      } finally {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
        lucide.createIcons();
      }
    });
    document.getElementById("tabla-admin-localidades").addEventListener("click", (e)=>{
      const btnEditar = e.target.closest(".btn-icono-chico.editar");
      const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
      if(btnEditar) abrirEdicion(Number(btnEditar.dataset.id));
      if(btnBorrar) borrar(Number(btnBorrar.dataset.id));
    });

    return {
      cargar,
      obtenerActivos: () => Object.values(localidadesPorNombre).map(l => l.nombre),
      obtenerPendientes: () => datosCps.filter(f => f.cordon_id == null).length,
    };
  }

  // Mismo patrón que actualizarAvisoChoferesPendientes() (ver más abajo):
  // badge en el ítem principal "Configuración" del sidebar + en el
  // sub-ítem "Localidades" del menú interno.
  function actualizarAvisoLocalidadesPendientes(){
    const pendientes = abmLocalidades.obtenerPendientes();
    const el = document.getElementById("contador-localidades-pendientes-submenu");
    el.hidden = pendientes === 0;
    el.textContent = pendientes;
    pendientesConfigState.localidades = pendientes;
    actualizarIconoPendientesConfig();
  }

  export const abmLocalidades = crearAbmLocalidades();
