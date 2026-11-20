# Lightdata: endpoint de listado de envíos

> Referencia técnica del endpoint interno que usa la pantalla **Envíos → Envios** de Lightdata (`https://mercadopacks.lightdata.app`) para traer envíos filtrados. Relevado el 18/11/2026. Usado por `scripts/vincular_choferes_envios.py` para traer `didcadete` y cruzar repartidores por ID (ver `reglas_de_negocio.md`, changelog 2026-11-18).

---

## 1. Resumen

| | |
|---|---|
| URL | `POST https://mercadopacks.lightdata.app/modules/envios/listado/procesar_listado.php` |
| Formato del body | `application/x-www-form-urlencoded` (objetos anidados al estilo jQuery `$.ajax`, ej. `filtros[estado]=5,9`) |
| Autenticación | Cookie de sesión de Lightdata (usuario logueado). No usa token. |
| Respuesta | JSON |
| Rendimiento | 500 registros por página en menos de 1 segundo |

⚠️ **No es una API pública documentada.** Depende de la sesión del navegador y Lightdata puede cambiarla sin aviso (ya pasó con otro endpoint de exportación, que hoy devuelve 404). Para una integración estable, pedir a Lightdata una API oficial o token.

⚠️ **Datos personales:** la respuesta incluye nombre y dirección de los compradores. Guardarlos solo donde haga falta y con acceso restringido.

---

## 2. Parámetros del request

| Parámetro | Tipo | Valor típico | Descripción |
|---|---|---|---|
| `cantxpagina` | int | `500` | Registros por página. |
| `pagina` | int | `1` | Página (empieza en 1). |
| `excel` | int | `0` | `0` = respuesta normal paginada. |
| `elim` | int | `0` | `0` = excluye envíos eliminados. |
| `historico` | bool | `false` | `true` = busca en el histórico. |
| `columnas` | array | ver §2.2 | Columnas visibles de la grilla. |
| `filtros` | objeto | ver §2.1 | Filtros de búsqueda. |

### 2.1 `filtros`

| Campo | Valor por defecto | Descripción |
|---|---|---|
| `fecha_desde` | `"04/11/2026"` | Formato `dd/mm/aaaa`. |
| `fecha_hasta` | `"18/11/2026"` | Formato `dd/mm/aaaa`. |
| `tipo_fecha` | `"1"` | Qué fecha usar en el rango (ver §4.2). |
| `estado` | lista de códigos | Códigos separados por coma, ej. `"5,9"` (ver §4.1). |
| `cadete` | `""` | **Nombre** del repartidor, exactamente como figura en el desplegable (ej. `"Sebastian Figueroa"`, respetando espacios dobles si los tiene). **No acepta el ID.** Vacío = todos. Ver §3.3. |
| `asignado` | `"2"` | `2` = todos. |
| `nombrecliente` | `""` | Nombre de la tienda/cliente. |
| `codigocliente` | `""` | Código de cliente. |
| `nombre` | `""` | Nombre del comprador/destinatario. |
| `cp` | `""` | Código postal. |
| `zonasdeentrega` | `""` | Zona de entrega. |
| `tracking_number` / `tracking_number_tipo` | `""` / `"coincidencia"` | Búsqueda por tracking. |
| `idml` / `idml_tipo` | `""` / `"coincidencia"` | ID de envío de MercadoLibre. |
| `seguimiento_eflet` / `seguimiento_eflet_tipo` | `""` / `"coincidencia"` | Seguimiento eFlet. |
| `andreani_numero` | `""` | Número de Andreani. |
| `logisticaInversa` | `"2"` | `2` = todos. |
| `obs` | `"2"` | Con/sin observaciones; `2` = todos. |
| `fotos` | `"2"` | Con/sin fotos; `2` = todos. |
| `cobranzas` | `"2"` | Con/sin cobranza; `2` = todos. |
| `domicilio` | `"0"` | |
| `tipoClientes` | `1` | |
| `origen`, `origen_entrega`, `servicio`, `turbo`, `deposito`, `metodo` | `""` | Filtros adicionales; vacío = todos. |

> Recomendación: mandar siempre el objeto `filtros` completo con estos valores por defecto y cambiar solo lo necesario.

### 2.2 `columnas`

Array de objetos `{ id, CDB, checked, orden }`. Los `CDB` actuales son:

`nombre_fantasia, ml_vendedor_id, flexname, tracking, fechaventa, fechagestionar, nombre, cp, zona, namecadete, estado_envio`

La respuesta trae más campos que estas columnas (ver §3), así que se pueden mandar tal como los envía la pantalla.

---

## 3. Respuesta

```json
{
  "estadoLogin": true,
  "tengo": true,
  "cantidadRegistros": 2394,
  "pagina": 1,
  "totalPaginas": 5,
  "cantElim": 109,
  "enviosElim": [],
  "rows": [ { ... } ]
}
```

- `estadoLogin: false` → la sesión expiró; hay que volver a loguearse.
- `cantidadRegistros` / `totalPaginas` → para recorrer todas las páginas.
- **Si no hay resultados, la respuesta no trae la clave `rows`** (no viene como array vacío). Usar `j.rows || []`.
- Rangos grandes son lentos: 54.607 entregados en 18 días tardó ~20 s en la primera página; un día (~3.700) tardó ~1,6 s. Preferir rangos cortos.

### 3.1 Campos de cada `row`

| Campo | Descripción |
|---|---|
| `did` | ID interno del envío en Lightdata. |
| `codigo` | Código del envío. |
| `tracking` | Número de tracking. |
| `flexname` | Nombre/identificador Flex. |
| `tipo_servicio` | Tipo de servicio. |
| `ml_vendedor_id` | ID del vendedor en MercadoLibre. |
| `fechaventa` | Fecha de venta. |
| `fechagestionar` | Fecha a gestionar. |
| `estimated_delivery_time_date_72` | Fecha estimada de entrega. |
| `lead_time_shipping_method_name` | Método de envío (ML). |
| `nombre` | Nombre del destinatario. |
| `direccion` | Dirección de entrega. |
| `cp` | Código postal. |
| `localidad` | Localidad. |
| `zona` | Zona de entrega. |
| `zonacosto` | Zona de costo. |
| `estado_envio` | Estado del envío (ver §4.1). |
| `estadoml` | Estado en MercadoLibre. |
| **`didcadete`** | **ID del repartidor asignado.** Vacío o `0` = sin asignar. |
| **`namecadete`** | **Nombre y apellido del repartidor.** |
| `didCliente` | ID del cliente (tienda). |
| `nombre_fantasia` | Nombre de fantasía del cliente. |
| `elimCli` | Marca de eliminación del cliente. |
| `valor_declarado` | Valor declarado. |
| `qr` | Datos del QR de la etiqueta. |

### 3.2 Relación con usuarios

`didcadete` es el mismo ID que el campo `ID` (`did`) del listado de usuarios de Lightdata (`modules/system_users/listado/procesar_listado.php`). Verificado: 270 → Alejandro Herrera, 528 → Micaela Fariña, 739 → William Rojas, 979 → Facundo Torres.

**Unir envíos con repartidores siempre por `didcadete` ↔ `ID`, nunca por nombre** (hay nombres repetidos y con espacios dobles, ej. `"Alejandro  Herrera"`).

### 3.3 Filtrar por repartidor

El filtro `filtros.cadete` recibe el **nombre**, no el ID (probado: con `"1067"` devuelve 0; con `"Sebastian Figueroa"` devuelve sus 49 envíos, todos con `didcadete = 1067`). Los valores válidos son los del desplegable `#envios_f_cadete` de la pantalla (854 opciones; `"__todos__"` = todos).

Para filtrar por ID desde tu sistema:

1. Buscar el nombre en el desplegable a partir del ID (vía tu tabla de usuarios: `Nombre + " " + Apellido`, sin hacer trim de espacios internos), **o**
2. Traer sin filtro de repartidor y filtrar por `didcadete` del lado de tu sistema (más confiable si hay homónimos).

---

## 4. Tablas de códigos

### 4.1 Estados (`estado` / `estado_envio`)

| Código | Estado |
|---|---|
| 0 | Retirado |
| 1 | En planta de procesamiento |
| 2 | En camino al destinatario |
| 3 | Devolviendo a planta de procesamiento |
| 5 | Entregado |
| 6 | Nadie |
| 7 | A retirar |
| 8 | Cancelado |
| 9 | Entregado 2da visita |
| 10 | Nadie 2da visita |
| 11 | En camino 2da visita |
| 12 | En camino reprogramado |
| 13 | No entregado |
| 14 | Devuelto al cliente |
| 15 | Rechazado por el comprador |
| 22 | Dirección incorrecta |
| 30 | Reprogramado por comprador |
| 31 | Reprogramado por Meli |

Agrupaciones que usa la pantalla:

| Grupo | Valor de `estado` |
|---|---|
| Pendientes | `0,1,2,3,7,6,13,10,12,11,30,31,8,15,22,50,51,52,53,54,55,56,57,58,59,60` |
| Cerrado | `5,9,14` |
| Entregado (1ra y 2da) | `5,9` |
| Todos | `-1` |

> Los códigos 50–60 aparecen en el grupo "Pendientes" pero no tienen nombre visible en la pantalla.

### 4.2 Tipo de fecha (`tipo_fecha`)

| Código | Fecha |
|---|---|
| 0 | Fecha de venta |
| 1 | Fecha MercadoPacks |
| 2 | Fecha entregado |
| 3 | Fecha asignación |
| 4 | Fecha despacho |
| 5 | Fecha colecta |
| 6 | Fecha a planta |
| 9 | Fecha cancelado |
| 15 | Fecha último movimiento |

---

## 5. Ejemplo de uso (consola del navegador)

Con Lightdata abierto y logueado, F12 → Console. Probado el 18/11/2026.

```js
async function traerEnvios({ desde, hasta, tipoFecha = "1", estado = "-1", cadeteNombre = "" }) {
  const filtros = {
    asignado: "2", nombrecliente: "", codigocliente: "", nombre: "", cp: "",
    estado, origen_entrega: "", logisticaInversa: "2",
    fecha_desde: desde, fecha_hasta: hasta, zonasdeentrega: "", origen: "",
    cadete: cadeteNombre, idml: "", idml_tipo: "coincidencia",
    seguimiento_eflet_tipo: "coincidencia", seguimiento_eflet: "",
    tracking_number: "", tracking_number_tipo: "coincidencia",
    tipo_fecha: tipoFecha, domicilio: "0", servicio: "", andreani_numero: "",
    obs: "2", turbo: "", tipoClientes: 1, fotos: "2", deposito: "",
    cobranzas: "2", metodo: ""
  };
  const columnas = ["nombre_fantasia","ml_vendedor_id","flexname","tracking","fechaventa",
    "fechagestionar","nombre","cp","zona","namecadete","estado_envio"]
    .map(CDB => ({ id: 0, CDB, checked: true, orden: "" }));   // id 0 funciona

  let pagina = 1, total = 1, rows = [];
  do {
    const body = $.param({ cantxpagina: 500, pagina, excel: 0, filtros, columnas, elim: 0, historico: false });
    const r = await fetch("modules/envios/listado/procesar_listado.php", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      body
    });
    const j = await r.json();
    if (!j.estadoLogin) throw new Error("Sesión expirada");
    rows = rows.concat(j.rows || []);        // sin resultados no viene "rows"
    total = j.totalPaginas || 0;
    pagina++;
  } while (pagina <= total);
  return rows;
}

// Ejemplo 1: entregados (5 y 9) por fecha de entrega, del 17 al 18/11, todos los repartidores
const envios = await traerEnvios({ desde: "17/11/2026", hasta: "18/11/2026", tipoFecha: "2", estado: "5,9" });

// Ejemplo 2: filtrar por ID de repartidor del lado del cliente
const delRepartidor = envios.filter(e => String(e.didcadete) === "1067");
console.table(delRepartidor.map(e => ({ tracking: e.tracking, estado: e.estado_envio, repartidor: e.namecadete, cp: e.cp })));

// Ejemplo 3: filtrar en el servidor por nombre (valor exacto del desplegable)
const sebastian = await traerEnvios({ desde: "17/11/2026", hasta: "18/11/2026", tipoFecha: "2", estado: "5,9", cadeteNombre: "Sebastian Figueroa" });
```

> `$` (jQuery) ya está cargado en Lightdata y se usa solo para `$.param`, que arma el body con objetos anidados. Fuera de Lightdata hay que serializar igual: `filtros[estado]=5,9&columnas[0][CDB]=tracking&...`.

---

## 6. Llamarlo desde fuera del navegador

Desde un servidor o script (Python, Apps Script, etc.) habría que enviar la cookie de sesión de Lightdata en el header `Cookie`. Consideraciones:

- La cookie vence; el script debe detectar `estadoLogin: false` y avisar.
- No guardar la cookie en código ni en planillas compartidas.
- Respetar paginación (500 por página) y no hacer consultas en loop rápido para no sobrecargar el sistema.
- Alternativa recomendada: solicitar a Lightdata un acceso oficial (API/token).
