# Integración: validar altas de usuarios contra Lightdata

> Contexto: Mercadopacks usa Lightdata (`https://mercadopacks.lightdata.app`) como sistema de envíos. Nuestro sistema, al dar de alta un repartidor, consulta la base de usuarios de Lightdata para saber si ya existe y traer sus datos. Implementado en `scripts/sincronizar_lightdata.py` — ver también `reglas_de_negocio.md` sección 6 (changelog 2026-11-17).

---

## 1. Objetivo

Al cargar un repartidor nuevo en nuestro sistema:

1. Buscar si ya existe en Lightdata (por usuario, o por nombre + apellido).
2. Si existe: vincularlo (guardar su `lightdata_id`) y avisar si está **bloqueado**.
3. Si no existe en nuestro roster: crearlo igual, pero marcándolo `pendiente_completar` (sin usuario en Lightdata o recién llegado de ahí, igual le faltan datos propios).
4. Evitar duplicados dentro de nuestro propio sistema.

---

## 2. Fuente de datos

### 2.1 Excel exportado (respaldo manual)

Hoja `Usuarios`, columnas:

| Columna | Tipo | Ejemplo | Notas |
|---|---|---|---|
| `ID` | entero | 1488 | ID interno de Lightdata (`did`). **Clave única** para vincular. |
| `Nombre` | texto | Alfredo | Puede venir con espacios sobrantes → aplicar `trim`. |
| `Apellido` | texto | Tabera | Mayúsculas/minúsculas inconsistentes. |
| `Usuario` | texto | alfredotabera | Login. Puede haber duplicados sin distinguir mayúsculas. |
| `Perfil` | texto | Chofer | Valores: `Administrativo`, `Chofer`, `Cliente`, `Coordinador`, `Logistica externa`. |
| `Habilitado` | Si/No | Si | |
| `Bloqueado` | Si/No | No | |
| `Codigo_empleado` | texto | 0 | "0" = sin código. |

Observaciones de calidad de datos:

- Puede haber combinaciones nombre + apellido repetidas (homónimos o cargas duplicadas). **No usar nombre + apellido como clave única**, solo como sugerencia/match.
- No trae email, DNI ni teléfono.

### 2.2 Endpoint de Lightdata (en vivo, `--live`)

No hay API pública documentada. La pantalla *Sistema → Usuarios* usa un endpoint interno:

```
POST https://mercadopacks.lightdata.app/modules/system_users/listado/procesar_listado.php
Content-Type: application/x-www-form-urlencoded  (formato jQuery $.ajax)
Requiere: cookie de sesión iniciada en Lightdata
```

Parámetros (serializados con el formato jQuery `$.param`, ver `_jquery_param()` en `scripts/sincronizar_lightdata.py`):

```json
{
  "cantxpagina": 2000,
  "pagina": 1,
  "filtros": { "nombre": "", "apellido": "", "usuario": "", "perfil": "-1" },
  "columnas": [
    {"id":41,"CDB":"nombre","checked":true,"orden":""},
    {"id":42,"CDB":"apellido","checked":true,"orden":""},
    {"id":43,"CDB":"usuario","checked":true,"orden":""},
    {"id":44,"CDB":"perfil","checked":true,"orden":""},
    {"id":45,"CDB":"habilitado","checked":true,"orden":""},
    {"id":46,"CDB":"bloqueado","checked":true,"orden":""}
  ],
  "empresa": 253
}
```

Respuesta:

```json
{
  "cantidadRegistros": 1303,
  "pagina": 1,
  "totalPaginas": 1,
  "rows": [
    {"did":1488,"nombre":"Alfredo ","apellido":"Tabera","usuario":"alfredotabera",
     "perfil":"Chofer","habilitado":1,"bloqueado":0,"codigo_empleado":"0","color":"000000"}
  ]
}
```

⚠️ Limitaciones:

- Depende de la sesión del navegador (acá, de un login por Playwright con la cuenta dedicada de Lightdata de este repo). Lightdata puede cambiarlo sin aviso — por eso `sincronizar_lightdata.py --live` corre con `continue-on-error: true` en el workflow, y queda el Excel manual como respaldo si deja de andar.

### 2.3 Script para reexportar a Excel (consola del navegador, respaldo manual)

Con la pantalla *Sistema → Usuarios* abierta en Lightdata, F12 → Console:

```js
(async () => {
  const req = {
    cantxpagina: 5000, pagina: 1,
    filtros: { nombre: "", apellido: "", usuario: "", perfil: "-1" },
    columnas: [41,42,43,44,45,46].map((id,i)=>({id, CDB:["nombre","apellido","usuario","perfil","habilitado","bloqueado"][i], checked:true, orden:""})),
    empresa: 253
  };
  const res = await $.ajax({ url: "modules/system_users/listado/procesar_listado.php", type: "POST", data: req });
  const j = typeof res === "string" ? JSON.parse(res) : res;
  const t = v => typeof v === "string" ? v.trim() : v;
  const data = j.rows.map(r => ({
    ID: Number(r.did), Nombre: t(r.nombre), Apellido: t(r.apellido), Usuario: t(r.usuario),
    Perfil: t(r.perfil), Habilitado: Number(r.habilitado) === 1 ? "Si" : "No",
    Bloqueado: Number(r.bloqueado) === 1 ? "Si" : "No", Codigo_empleado: t(r.codigo_empleado)
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Usuarios");
  XLSX.writeFile(wb, `usuarios_lightdata_${new Date().toISOString().slice(0,10)}.xlsx`);
})();
```

---

## 3. Modelo de datos (implementado)

Tabla `lightdata_usuarios` (espejo, solo lectura para el usuario final — ver `scripts/migraciones/2026-11-16_lightdata_usuarios.sql`):

| Campo | Tipo | Notas |
|---|---|---|
| `lightdata_id` | int, PK | = `ID` / `did` |
| `nombre` | text | trim |
| `apellido` | text | trim |
| `usuario` | text | trim, índice |
| `usuario_norm` | text | normalizado, índice |
| `nombre_completo_norm` | text | normalizado (ver §4.1), índice |
| `perfil` | text | |
| `habilitado` | bool | |
| `bloqueado` | bool | |
| `codigo_empleado` | text null | "0" → null |
| `actualizado_en` | timestamptz | fecha de la última importación |
| `activo_en_ultima_import` | bool | false si dejó de venir en la última corrida |

En `choferes_roster`: `lightdata_id int null` (único cuando no es null, FK a `lightdata_usuarios`) + `pendiente_completar bool`.

---

## 4. Procesos (implementado en `scripts/sincronizar_lightdata.py`)

### 4.1 Normalización (`normalizar()`, usada igual para importar y para matchear)

```
normalizar(texto):
  - trim y colapsar espacios múltiples
  - minúsculas
  - quitar acentos (á→a, ñ→n)
  - quitar caracteres que no sean letras, números o espacio
```

### 4.2 Importación / actualización (`sincronizar()`)

1. `--live` (endpoint de Lightdata) o un .xlsx como argumento (respaldo manual).
2. **Upsert** por `lightdata_id` en `lightdata_usuarios`.
3. Los `lightdata_id` que estaban y no vinieron en esta corrida → `activo_en_ultima_import = false` (no se borran).
4. Imprime resumen: nuevos, actualizados, sin cambios, desaparecidos.

### 4.3 Vinculación con `choferes_roster` (`vincular_choferes()`)

Solo para perfil `Chofer` no bloqueado:

1. Si el `lightdata_id` ya está vinculado a un repartidor → no hace nada.
2. Si no, busca por **nombre completo normalizado** (nunca nombre exacto) entre los repartidores *sin vincular*:
   - Exactamente 1 candidato → se vincula (`update lightdata_id`).
   - Más de 1, o el nombre ya está tomado por un repartidor vinculado a OTRO `lightdata_id` (dos personas/cuentas distintas con el mismo nombre) → se imprime `[REVISAR]`, no se toca nada (evita duplicar el nombre, que es `unique` en `choferes_roster`).
3. Si no hay ningún candidato → se **crea** el repartidor en `choferes_roster` con `pendiente_completar = true`.

---

## 5. Comportamiento en la UI (implementado en `index.html`)

- Badge contador en "Configuración" (sidebar) y en "Repartidores" (submenú de Configuración) con la cantidad de `pendiente_completar`.
- Banner amarillo arriba de la tabla de Repartidores con el conteo y un botón "Ver solo pendientes".
- Fila resaltada + badge "Pendiente" por repartidor.
- Al completar vehículo + zona + al menos una localidad en el ABM, `pendiente_completar` pasa a `false` solo.
- Homónimos (match ambiguo) se loggean en la consola del workflow como `[REVISAR]`, no se automatiza — hay que resolverlos a mano en el ABM.

---

## 6. Automatización

`sincronizar_lightdata.py --live` corre como paso extra de `.github/workflows/publicar_supabase.yml`, con `continue-on-error: true` (si el endpoint interno de Lightdata cambia, no debe tumbar la publicación de envíos). Mismo horario que el resto del workflow (cron-job.org, cada 10 min en horario operativo).

---

## 7. Mejoras futuras

- Si Lightdata ofrece alguna vez una API/token oficial, reemplazar el endpoint interno.
- Matching aproximado (Levenshtein/trigram) para sugerir homónimos en vez de solo loggearlos.
- Reporte visual en el dashboard de los casos `[REVISAR]` (hoy solo quedan en el log del workflow).
