// Helpers de formato de fecha/texto/moneda usados en toda la app.
// Vienen de index.html (Etapa 1 de migración a ES Modules, 2026-11-24).

// "Fecha venta"/"Fecha estado"/"Fecha asignación"/"Fecha a planta"/
// "Fecha colecta" vienen de Lightdata como timestamptz completo — bug
// real 2026-11-23: se mostraban crudas ("2026-11-23T01:52:00+00:00") en
// vez de un formato legible. "Fecha Mercadopacks" NO pasa por acá: esa sí
// es solo fecha (sin hora), llega ya en "2026-11-22".
// Pedido 2026-11-24: toda fecha SIN hora (fecha_inicio/fecha_fin de
// liquidaciones, fecha de Extras, etc.) se muestra DD/MM/AAAA — acepta
// tanto "2026-11-23" como un timestamp completo (usa solo los primeros
// 10 caracteres), sin pasar por Date()/timezone (evita el típico
// corrimiento de un día al parsear "YYYY-MM-DD" como UTC medianoche).
export function formatearFecha(valor){
  if(!valor) return "—";
  const m = String(valor).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valor);
}

export function formatearFechaHora(valor){
  if(!valor) return "—";
  const fecha = new Date(valor);
  if(Number.isNaN(fecha.getTime())) return valor;
  // timeZone explícito: regla del proyecto es ART fijo sin importar el
  // huso horario del navegador/sistema operativo de quien mira la
  // pantalla (mismo criterio que parsear_fecha() en la ingesta).
  return fecha.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Solo para MOSTRAR texto que viene de la base (Lightdata/choferes_roster
// traen una mezcla de MAYÚSCULAS, minúsculas y Mixto en nombres, clientes,
// localidades, etc.) — nunca se usa para matchear/agrupar/comparar, eso
// sigue siendo con el valor crudo. Regla de sistema (ver reglas_de_negocio.md,
// sección 1, regla 15): cualquier texto libre de la base que se muestre en
// pantalla pasa por acá. `tituloNombre` es un alias semántico para cuando
// específicamente es un nombre de persona.
export function tituloTexto(s){
  return (s || "").toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
}
export function tituloNombre(s){ return tituloTexto(s); }

// Pedido 2026-11-27: distinto de tituloTexto() a propósito -- tituloTexto
// pone mayúscula a la PRIMERA letra de CADA palabra ("Indumentaria Y
// Calzado", con la "y" también mayúscula), y para razones sociales de
// cliente eso se ve mal con conectores ("y", "de"). Esta pasa todo a
// minúscula y solo sube la primera letra de la CADENA entera
// ("Indumentaria y calzado"). Usada en el "By: <Cliente>" del sidebar
// (ver actualizarMarcaCliente() en sesion.js) para no mostrar
// lightdata_clientes.nombre_fantasia tal cual viene (a veces TODO EN
// MAYÚSCULAS en el origen).
export function primeraMayuscula(s){
  const t = (s || "").toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

// Formato moneda AR ($ 0.000,00) para los inputs de precios (pedido
// 2026-11-21, módulo de Precios por Cliente) — los inputs son type="text"
// (un type="number" nativo no puede mostrar separador de miles ni "$",
// el navegador lo rechaza como valor inválido), con inputmode="decimal"
// para que el teclado numérico salga en mobile. `parsearMoneda` siempre
// vuelve a un número de JS (o null si está vacío) para guardar en la
// base — nunca se guarda el string formateado.
export function formatearMoneda(n){
  if(n == null || n === "") return "";
  const num = Number(n);
  if(Number.isNaN(num)) return "";
  return "$ " + num.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function parsearMoneda(s){
  if(s == null) return null;
  const limpio = String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  if(limpio === "") return null;
  const num = Number(limpio);
  return Number.isNaN(num) ? null : num;
}
