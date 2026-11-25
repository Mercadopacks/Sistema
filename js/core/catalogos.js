// Catálogos compartidos entre pantallas: clientes de Lightdata (lightdata_clientes
// habilitados) y cómo se muestran (labelCliente/nombreCliente).
// Viene de index.html (Etapa 4b de migración a ES Modules, 2026-11-25).
// `catalogos.clientes` reemplaza al `let clientesDisponibles` del IIFE: un import
// es de solo lectura para quien lo importa, así que Envíos, Usuarios y Adicionales
// no podrían reasignar un `let` exportado — sí pueden reasignar una propiedad de
// un objeto exportado (`catalogos.clientes = data || []`), que es lo que hacen.
// La referencia a clavesAVistasLabel/labelsAVistasClave de abajo apunta a la
// sección Usuarios de index.html.

  export const catalogos = { clientes: [] };   // clientes: [{did, nombre_fantasia, codigo}]

  // El multiselect genérico del modal trabaja con labels (string = value),
  // no con pares {id,nombre} — mismo patrón que clavesAVistasLabel/
  // labelsAVistasClave de arriba, pero para clientes. El label combina
  // código + nombre de fantasía para distinguir clientes con nombres
  // parecidos.
  export function labelCliente(c){ return c.codigo ? `${c.codigo} - ${c.nombre_fantasia || "(sin nombre)"}` : (c.nombre_fantasia || `Cliente ${c.did}`); }
  // Pedido 2026-11-24: en la mayoría de las pantallas el código de cliente
  // adelante es ruido — labelCliente() sigue existiendo tal cual para el
  // multiselect de "Clientes asociados" de Usuarios (ahí el código es lo
  // que evita colisiones entre 2 clientes con el mismo nombre de fantasía,
  // ver nota arriba), nombreCliente() es la versión limpia para todo lo
  // demás (combos de selección por did, títulos de modal, grillas).
  export function nombreCliente(c){ return (c && (c.nombre_fantasia || c.codigo)) || `Cliente ${c ? c.did : ""}`; }
