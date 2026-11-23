# Lightdata: clientes y cuentas asociadas

> Referencia técnica para traer **todos los datos de los clientes** de Lightdata (`https://mercadopacks.lightdata.app`) junto con **los IDs de sus cuentas de integración** (MercadoLibre, Tienda Nube, etc.), para poder saber a qué cliente pertenece un envío. Relevado y probado el 20/11/2026.

---

## 1. Resumen

| # | Endpoint | Body | Qué trae |
|---|---|---|---|
| A | `modules/clientes/listado/procesar_listado.php` | filtros + paginación | Listado liviano (grilla). Incluye deshabilitados. |
| B | `modules/clientes/alta/controlador.php` | `operador=getClientes` | **Todos los clientes habilitados** con datos completos, contactos y direcciones. **Sin cuentas.** |
| C | `modules/clientes/alta/controlador.php` | `operador=getCliente&did=<id>` | Un cliente con datos completos, contactos, direcciones **y cuentas**. |
| D | `modules/envios/alta/controlador.php` | `operador=get&did=<idEnvio>` | Detalle de un envío; trae `didCliente`, `didCuenta` y `ml_vendedor_id`. |

| | |
|---|---|
| Base URL | `https://mercadopacks.lightdata.app/` |
| Método | `POST` |
| Body | `application/x-www-form-urlencoded` (objetos anidados estilo jQuery) |
| Autenticación | Cookie de sesión de Lightdata. No usa token. |
| Respuesta | JSON |

**Para tener clientes + cuentas** hay que combinar **B** (todos los datos en 1 llamada) con **C** (una llamada por cliente para las cuentas). Con 297 clientes y 4 llamadas en paralelo tarda **~1,5 minutos**. `scripts/ingesta_lightdata/sincronizar_clientes_lightdata.py` (agregado 2026-11-20) usa solo **B** — alcanza para el nombre/código que necesita el ABM de Usuarios; si en el futuro hace falta el mapeo de cuentas (ML/Tienda Nube) para asignar envíos sin `did_cliente`, ahí sí conviene sumar **C**.

⚠️ **No es una API pública documentada.** Depende de la sesión del navegador y puede cambiar sin aviso.

⚠️ **Las cuentas traen credenciales** (tokens/secretos de WooCommerce, Shopify, VTEX, etc.) y el header trae `token_api_ext`. **No se guardan**: solo se toman los IDs (ver §4.3).

---

## 2. Datos del cliente

### 2.1 Endpoint B: `getClientes` (todos, una llamada)

```
POST modules/clientes/alta/controlador.php
operador=getClientes
```

Devuelve un array (hoy 296 clientes; **no incluye los deshabilitados**, ej. el `did` 348):

```json
[
  { "header": { ... }, "contactos": [ ... ], "direcciones": [ ... ] }
]
```

Para incluir deshabilitados, tomar los `did` del listado (endpoint A con `habilitado: "2"`) y pedirlos con C.

### 2.2 `header`

| Campo | Descripción | Guardar |
|---|---|---|
| `did` | **ID interno del cliente.** Clave de unión con envíos y usuarios. | ✅ |
| `codigo` | Código visible (ej. `"666"`). **Distinto de `did`.** | ✅ |
| `nombre_fantasia` | Nombre de fantasía (hacer `trim`). | ✅ |
| `razon_social` | Razón social (mayormente vacía). | ✅ |
| `doc_tipo` | Código AFIP de documento (`96` DNI, `80` CUIT). | ✅ |
| `doc_num` | Número de documento. | ✅ |
| `tipo_responsable` | Condición frente al IVA (código). | ✅ |
| `obs` | Observaciones. | ✅ |
| `habilitado` | `"1"` / `"0"`. | ✅ |
| `listaPrecios` | ID de lista de precios. | ✅ |
| `didCadeteAsignado` | Repartidor por defecto (ID de usuario; `0` = ninguno). | ✅ |
| `didDeposito` | Depósito (`0` = ninguno). | ✅ |
| `fullfilment` | Usa fulfillment. | ✅ |
| `estadosALiquidar` | Estados de envío que se liquidan, ej. `"5,9,6,10,13"`. | ✅ |
| `horacierre` | Hora de cierre. | ✅ |
| `codigoVinculacionLogE` | Código de vinculación de logística externa. | ✅ |
| `token_api_ext` | Token de API externa. | ❌ **No guardar** |

### 2.3 `contactos[]` (33 clientes tienen)

| Campo | Descripción |
|---|---|
| `id`, `did` | IDs del contacto. |
| `cliente` | ID del cliente. |
| `tipo_contacto` | Tipo (código: teléfono, mail, etc.). |
| `valor` | Teléfono / email. |
| `contacto` | Nombre de la persona. |
| `referencia` | Referencia. |
| `defaultc` | Contacto principal. |
| `quien`, `autofecha` | Usuario y fecha de carga. |
| `superado`, `elim` | Usar solo `superado = 0` y `elim = 0`. |

### 2.4 `direcciones[]` (46 clientes tienen)

| Campo | Descripción |
|---|---|
| `id`, `did`, `codigo` | IDs de la dirección. |
| `cliente` | ID del cliente. |
| `tipo_direccion` | Tipo (código). |
| `pais`, `provincia`, `localidad`, `ciudad` | Ubicación. |
| `calle`, `numero`, `cp` | Domicilio. |
| `ilat`, `ilong` | Coordenadas. |
| `mail`, `referencias` | Datos extra. |
| `dias_colecta`, `horarios_colecta`, `horario_tope`, `horarios`, `fechasDefaultColecta`, `horaDefaultColecta` | Configuración de colecta. |
| `quien`, `autofecha`, `superado`, `elim` | Auditoría (usar `superado = 0`, `elim = 0`). |

---

## 3. Cuentas asociadas (integraciones)

### 3.1 Endpoint C: `getCliente`

```
POST modules/clientes/alta/controlador.php
operador=getCliente&did=346
```

Respuesta: `{ header, contactos, direcciones, cuentas }`. El `header`, `contactos` y `direcciones` son iguales a §2.

### 3.2 `cuentas[]`

Cada cliente tiene **una entrada por tipo de integración**, aunque esté vacía, y puede tener **varias cuentas del mismo tipo** (ej. varias cuentas de MercadoLibre; un cliente tiene 81). Total relevado: 3.412 entradas en 297 clientes.

Campos de ID (los que hay que guardar):

| Campo | Descripción |
|---|---|
| `did` | **ID de la cuenta en Lightdata.** Es el `didCuenta` del envío. |
| `didCliente` | ID del cliente dueño de la cuenta. |
| `tipoCuenta` | Tipo de integración (ver §3.3). |
| `ML_id_vendedor` | **ID de vendedor (seller_id) de MercadoLibre.** |
| `ML_user` | Usuario (nickname) de MercadoLibre. |
| `tn_id` | ID de tienda de Tienda Nube. |
| `tn_url` | URL de la tienda en Tienda Nube. |
| `shop_url` | URL de Shopify. |
| `woo_web` | URL de WooCommerce. |
| `vtex_url`, `vtex_idlogistica` | VTEX. |
| `pre_url` | PrestaShop. |
| `fala_url` | Falabella. |

Campos de configuración (opcionales): `metodoIngreso`, `ingreso_automatico`, `fulfillment`, `me1`, `sync`, `sync_woo`, `webhook`, `magentoConnectionError`.

Campos ❌ **que no se guardan** (credenciales): `woo_api`, `woo_secreto`, `shop_api`, `shop_api2`, `pre_api`, `vtex_key`, `vtex_token`, `fala_key`, `fala_userid`, `jumpseller_login`, `jumpseller_token`, `magentoConnection`, `data`.

### 3.3 `tipoCuenta` (relevado en los 297 clientes)

| tipoCuenta | Integración | Entradas | Con ID cargado |
|---|---|---|---|
| 1 | **MercadoLibre** | 533 | 460 con `ML_id_vendedor` (428 sellers distintos) |
| 2 | **Tienda Nube** | 296 | 34 con `tn_id` |
| 3 | **Shopify** | 296 | 1 con `shop_url` |
| 4 | **WooCommerce** | 295 | 1 con `woo_web` |
| 5, 6, 7, 8, 9, 18, 21, 22, 33 | Otras (PrestaShop, VTEX, Falabella, Jumpseller, etc.; mapeo no confirmado) | — | 0 con datos hoy |

> Una cuenta "vacía" (sin ID de la integración) no sirve para identificar envíos; filtrar las que tengan al menos un ID.

⚠️ Hay **1 `ML_id_vendedor` asociado a más de un cliente**. Si al buscar un seller aparecen varios clientes, marcarlo como ambiguo y resolver con `didCuenta` del envío.

---

## 4. ¿A qué cliente pertenece un envío?

### 4.1 Reglas (en orden de prioridad)

| # | Si tenés… | Cómo resolver | Fuente |
|---|---|---|---|
| 1 | Un envío del **listado** de Lightdata | Usar directo `didCliente` → `cliente.did`. | Listado de envíos |
| 2 | El **detalle** de un envío de Lightdata | `didCuenta` → `cuenta.did` → `cuenta.didCliente` (también trae `didCliente`). | Endpoint D |
| 3 | Un envío de **MercadoLibre** (fuera de Lightdata) | `seller_id` del envío → `cuenta.ML_id_vendedor` (con `tipoCuenta = 1`) → `didCliente`. | Cuentas |
| 4 | Una orden de **Tienda Nube** | `store_id` → `cuenta.tn_id` (con `tipoCuenta = 2`) → `didCliente`. | Cuentas |

Verificado en una muestra de 20 envíos (uno por cliente): **17 de 17** envíos con cuenta tenían `didCuenta` de una cuenta del mismo cliente y `ml_vendedor_id` igual al `ML_id_vendedor` de esa cuenta. Los otros 3 tenían `didCuenta = 0` (carga manual / sin integración): para esos solo vale `didCliente`.

Nota para este repo (Mercadopacks Sistema): `envios.did_cliente` ya viene completado directamente por `vincular_choferes_envios.py` desde el endpoint en vivo (regla 1 de la tabla de arriba — el listado de envíos ya trae `didCliente`), así que el acceso por cliente (ver `reglas_de_negocio.md`, changelog 2026-11-20) se resuelve contra esa columna sin necesitar el mapeo de cuentas de la sección 3.

### 4.2 Ojo con `ml_vendedor_id`

| Dónde | Qué contiene realmente |
|---|---|
| **Listado** de envíos (`modules/envios/listado/procesar_listado.php`) | El **ID de la venta/orden** de ML (16 dígitos, a veces con sufijo), **no** el seller. |
| **Detalle** de envío (`operador=get`) → `header.ml_vendedor_id` | El **seller_id** del vendedor (igual a `cuenta.ML_id_vendedor`). |

El detalle también trae `ml_venta_id`, `ml_pack_id` y `ml_shipment_id`.

### 4.3 Modelo sugerido en tu sistema

**`lightdata_clientes`**: `did` (PK), `codigo`, `nombre_fantasia`, `razon_social`, `doc_tipo`, `doc_num`, `tipo_responsable`, `obs`, `habilitado`, `lista_precios`, `did_cadete_asignado`, `did_deposito`, `fullfilment`, `estados_a_liquidar`, `hora_cierre`, `codigo_vinculacion_loge`, `actualizado_en`.

> En este repo, `lightdata_clientes` (migración `2026-11-20_tipo_usuario_y_acceso_por_cliente.sql`) solo tiene por ahora `did`/`codigo`/`nombre_fantasia`/`razon_social`/`habilitado`/`actualizado_en` — los campos que necesita el combo del ABM de Usuarios. El resto de columnas de este modelo sugerido (contactos, direcciones, cuentas) se agregan si/cuando haga falta (ej. liquidación de clientes).

**`lightdata_cliente_contactos`** y **`lightdata_cliente_direcciones`**: como §2.3 y §2.4, FK `cliente` → `lightdata_clientes.did`.

**`lightdata_cuentas`**: `did` (PK), `did_cliente` (FK), `tipo_cuenta`, `ml_id_vendedor` (índice), `ml_user`, `tn_id` (índice), `tn_url`, `shop_url`, `woo_web`, `vtex_url`, `pre_url`, `fala_url`, `actualizado_en`. **Sin columnas de credenciales.**

Para asignar un envío:

```sql
-- por seller de MercadoLibre
SELECT did_cliente FROM lightdata_cuentas WHERE tipo_cuenta = 1 AND ml_id_vendedor = :seller_id;
-- por cuenta de Lightdata
SELECT did_cliente FROM lightdata_cuentas WHERE did = :did_cuenta;
```

---

## 5. Script de extracción (consola del navegador, probado)

Con Lightdata abierto y logueado, F12 → Console. Devuelve `{ clientes, cuentas }` sin credenciales.

```js
const LD = (() => {
  const post = (url, data) => fetch(url, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
    body: $.param(data)                       // $ = jQuery, ya cargado en Lightdata
  }).then(r => r.json());

  const ID_CUENTA = ["did","didCliente","tipoCuenta","ML_id_vendedor","ML_user","tn_id","tn_url",
                     "shop_url","woo_web","vtex_url","vtex_idlogistica","pre_url","fala_url"];
  const ID_EXTERNOS = ["ML_id_vendedor","tn_id","tn_url","shop_url","woo_web","vtex_url","pre_url","fala_url"];
  const vacio = v => v === null || v === undefined || v === "" || v === "0";

  function limpiarHeader(h) {
    const { token_api_ext, ...resto } = h;              // descarta el token
    return { ...resto, did: Number(h.did), nombre_fantasia: (h.nombre_fantasia || "").trim() };
  }
  function limpiarCuenta(c) {
    const o = {};
    ID_CUENTA.forEach(k => { if (!vacio(c[k])) o[k] = typeof c[k] === "string" ? c[k].trim() : c[k]; });
    return o;
  }

  async function traerTodo({ incluirDeshabilitados = true, paralelo = 4 } = {}) {
    // 1) Ids: listado (incluye deshabilitados)
    const lista = await post("modules/clientes/listado/procesar_listado.php", {
      cantxpagina: 1000, pagina: 1, empresa: 253,
      filtros: { codigo: "", fantasia: "", razon: "", numero: "", habilitado: incluirDeshabilitados ? "2" : "1",
                 mlid: "", num_vendedor: "", integraciones: [], tieneListaPrecios: "2", listaPrecios: "0" },
      columnas: [61,62,63,65,66].map((id, i) => ({ id, CDB: ["cl.codigo","cl.nombre_fantasia","cl.razon_social","cl.doc_num","cl.habilitado"][i], checked: true, orden: "" }))
    });
    if (!lista.estadoLogin) throw new Error("Sesión expirada");
    const ids = (lista.rows || []).map(r => r.did);

    // 2) Detalle de cada cliente (datos + contactos + direcciones + cuentas)
    const clientes = [], cuentas = [];
    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        const d = await post("modules/clientes/alta/controlador.php", { operador: "getCliente", did: id });
        if (!d || !d.header) continue;
        clientes.push({
          ...limpiarHeader(d.header),
          contactos: (d.contactos || []).filter(c => c.superado == 0 && c.elim == 0),
          direcciones: (d.direcciones || []).filter(x => x.superado == 0 && x.elim == 0)
        });
        (d.cuentas || [])
          .map(limpiarCuenta)
          .filter(c => ID_EXTERNOS.some(k => c[k]))     // solo cuentas con algún ID externo
          .forEach(c => cuentas.push(c));
      }
    };
    await Promise.all(Array.from({ length: paralelo }, worker));
    return { clientes, cuentas };
  }

  return { post, traerTodo };
})();

const { clientes, cuentas } = await LD.traerTodo();
console.log(clientes.length, "clientes,", cuentas.length, "cuentas con ID");
console.table(cuentas.slice(0, 20));

// Descargar como JSON para importar en tu sistema
const blob = new Blob([JSON.stringify({ extraido: new Date().toISOString(), clientes, cuentas }, null, 2)], { type: "application/json" });
const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "lightdata_clientes_cuentas.json" });
a.click();
```

> Si solo necesitás los datos sin cuentas, `LD.post("modules/clientes/alta/controlador.php", { operador: "getClientes" })` los trae en una llamada — es justo lo que hace `scripts/ingesta_lightdata/sincronizar_clientes_lightdata.py`.

### 5.1 Detalle de un envío (para `didCuenta`)

```js
const env = await LD.post("modules/envios/alta/controlador.php", { operador: "get", did: 1249289 });
const { didCliente, didCuenta, ml_vendedor_id, ml_shipment_id, ml_venta_id } = env.header;
```

---

## 6. Relación con usuarios y envíos

| Desde | Campo | Hacia | Verificado |
|---|---|---|---|
| Listado de envíos | `didCliente` | `cliente.did` | ✅ 37/37 clientes en muestra del 19–20/11 |
| Detalle de envío | `didCuenta` | `cuenta.did` | ✅ 17/17 envíos con cuenta |
| Detalle de envío | `ml_vendedor_id` (seller) | `cuenta.ML_id_vendedor` | ✅ 17/17 |
| Usuarios (perfil Cliente) | `codigo_empleado` | `cliente.did` | ✅ ej. `normang` → 346 Norman Group |
| Cliente | `didCadeteAsignado` | `usuario.ID` (repartidor) | Mismo ID de usuarios |

⚠️ Unir siempre por `did`, nunca por `codigo` ni por nombre (Norman Group: `did = 346`, `codigo = "666"`).

Usuarios de perfil Cliente cuyo `codigo_empleado` no existe en clientes (ej. `29`) → probablemente clientes eliminados.

---

## 7. Recomendaciones

- Sincronizar clientes y cuentas **una vez por día** (o antes de liquidar/asignar). Upsert por `did`.
- No correr la extracción completa en loop: son ~300 llamadas al sistema de Lightdata.
- Guardar la fecha de extracción para saber qué tan actualizado está el mapeo de cuentas.
- Si un envío no se puede asignar (seller desconocido), volver a sincronizar las cuentas antes de marcarlo como "sin cliente": puede ser una cuenta nueva.
