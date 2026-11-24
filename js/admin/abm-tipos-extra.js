// ABM de Tipos de extra/descuento para liquidaciones de clientes.
// Viene de index.html (Etapa 2 de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { mostrarAviso, mostrarConfirmacion } from "../ui/dialogos.js";
import { abrirModalAbm } from "../ui/modal-abm.js";

  // ABM de Tipos de extra/descuento (pedido 2026-11-23, liquidación de
  // clientes): casi igual a crearAbmSimple pero con un campo extra
  // (requiere_envio) que define qué campo muestra el modal de carga de
  // un extra — con envío (busca por tracking/ID de venta) o sin envío
  // (Dirección), ver inicializarExtrasLiquidacion() más abajo.
  function crearAbmTiposExtra(){
    let datos = [];
    let busqueda = "";
    let cargado = false;

    async function cargar(forzar){
      if(cargado && !forzar) return;
      const { data, error } = await sb.from("parametros_tipos_extra").select("*").order("nombre");
      if(error){ console.error("Error cargando parametros_tipos_extra:", error); return; }
      datos = data || [];
      cargado = true;
      render();
    }

    function render(){
      let filas = datos;
      if(busqueda) filas = filas.filter(f => (f.nombre || "").toLowerCase().includes(busqueda));
      const tbody = document.getElementById("tabla-admin-tipos-extra");
      if(!filas.length){
        tbody.innerHTML = `<tr><td colspan="7" class="sin-datos">Sin tipos cargados.</td></tr>`;
        return;
      }
      const labelAplicaA = { cliente: "Cliente", repartidor: "Repartidor", ambos: "Ambos" };
      tbody.innerHTML = filas.map(f => `
        <tr class="${f.activo ? "" : "fila-inactiva"}" data-id="${f.id}">
          <td>${f.nombre}${f.activo ? "" : '<span class="badge-inactivo">Inactivo</span>'}</td>
          <td>${f.signo === "descuento" ? "Descuento" : "Adicional"}</td>
          <td>${labelAplicaA[f.aplica_a] || f.aplica_a}</td>
          <td>${f.requiere_envio ? "Sí" : "No"}</td>
          <td>${f.requiere_direccion ? "Sí" : "No"}</td>
          <td>${f.activo ? "Sí" : "No"}</td>
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

    function campos(){
      return [
        { clave: "nombre", label: "Concepto", tipo: "texto" },
        // Pedido 2026-11-23 (2da vuelta): primero Adicional/Descuento,
        // después el Concepto puntual dentro de ese signo (ver combo de
        // Signo en el modal de Extras).
        { clave: "signo", label: "Signo", tipo: "select", opciones: [
          { valor: "adicional", texto: "Adicional (saldo positivo)" },
          { valor: "descuento", texto: "Descuento (saldo negativo)" },
        ] },
        // Catálogo compartido con Liquidación Repartidores a futuro (ver
        // migración 2026-11-23e_liquidacion_extras.sql) — esto filtra qué
        // tipos ofrece cada pantalla.
        { clave: "aplica_a", label: "Aplica a", tipo: "select", opciones: [
          { valor: "cliente", texto: "Cliente" },
          { valor: "repartidor", texto: "Repartidor" },
          { valor: "ambos", texto: "Ambos" },
        ] },
        // Separado de "requiere_envio" a propósito (pedido 2026-11-24): no
        // todo concepto sin envío necesita Dirección (ej. "Adelanto" de
        // un repartidor no es ni envío ni dirección) — solo los de Flete.
        { clave: "requiere_envio", label: "Pide envío", tipo: "checkbox" },
        { clave: "requiere_direccion", label: "Pide Dirección (ej. Flete)", tipo: "checkbox" },
        { clave: "activo", label: "Activo", tipo: "checkbox" },
      ];
    }

    function abrirAlta(){
      abrirModalAbm("Agregar tipo de extra/descuento", campos(), { activo: true, aplica_a: "cliente", signo: "adicional" }, async (vals)=>{
        if(!vals.nombre){ await mostrarAviso("El nombre es obligatorio."); return false; }
        if(!vals.signo){ await mostrarAviso("Elegí si es Adicional o Descuento."); return false; }
        const payload = { nombre: vals.nombre, signo: vals.signo, aplica_a: vals.aplica_a || "cliente", requiere_envio: !!vals.requiere_envio, requiere_direccion: !!vals.requiere_direccion, activo: !!vals.activo };
        const { data, error } = await sb.from("parametros_tipos_extra").insert(payload).select().single();
        if(error){ await mostrarAviso("No se pudo guardar (¿ya existe ese nombre?)."); return false; }
        datos.push(data);
        render();
      });
    }

    function abrirEdicion(id){
      const fila = datos.find(f => f.id === id);
      if(!fila) return;
      abrirModalAbm("Editar tipo de extra/descuento", campos(), fila, async (vals)=>{
        if(!vals.nombre){ await mostrarAviso("El nombre es obligatorio."); return false; }
        if(!vals.signo){ await mostrarAviso("Elegí si es Adicional o Descuento."); return false; }
        const payload = { nombre: vals.nombre, signo: vals.signo, aplica_a: vals.aplica_a || "cliente", requiere_envio: !!vals.requiere_envio, requiere_direccion: !!vals.requiere_direccion, activo: !!vals.activo };
        const { error } = await sb.from("parametros_tipos_extra").update(payload).eq("id", id);
        if(error){ await mostrarAviso("No se pudo guardar."); return false; }
        Object.assign(fila, payload);
        render();
      });
    }

    async function borrar(id){
      if(!(await mostrarConfirmacion("¿Borrar este registro? No se puede deshacer."))) return;
      const { error } = await sb.from("parametros_tipos_extra").delete().eq("id", id);
      if(error){ console.error(error); await mostrarAviso("No se pudo borrar."); return; }
      datos = datos.filter(f => f.id !== id);
      render();
    }

    document.getElementById("buscar-admin-tipos-extra").addEventListener("input", (e)=>{
      busqueda = e.target.value.toLowerCase();
      render();
    });
    document.getElementById("btn-agregar-tipo-extra").addEventListener("click", abrirAlta);
    document.getElementById("tabla-admin-tipos-extra").addEventListener("click", (e)=>{
      const btnEditar = e.target.closest(".btn-icono-chico.editar");
      const btnBorrar = e.target.closest(".btn-icono-chico.borrar");
      if(btnEditar) abrirEdicion(Number(btnEditar.dataset.id));
      if(btnBorrar) borrar(Number(btnBorrar.dataset.id));
    });

    return {
      cargar,
      // aplicaA opcional ("cliente"/"repartidor") filtra el catálogo
      // compartido — "ambos" siempre se incluye sea cual sea el filtro.
      obtenerActivosConId: (aplicaA) => datos
        .filter(f => f.activo && (!aplicaA || f.aplica_a === aplicaA || f.aplica_a === "ambos"))
        .map(f => ({ valor: f.id, texto: f.nombre, requiereEnvio: !!f.requiere_envio, requiereDireccion: !!f.requiere_direccion, signo: f.signo })),
    };
  }
  export const abmTiposExtra = crearAbmTiposExtra();
