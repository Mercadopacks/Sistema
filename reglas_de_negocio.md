# Reglas de Negocio y Arquitectura — Mercadopacks Sistema

Este documento es la fuente de verdad de **este repo** (Mercadopacks
Sistema, sobre Supabase). El dashboard de producción sobre Firestore
("Mercadopacks Métricas") tiene su propio `reglas_de_negocio.md` en el
repo `mercadopacks-metricas-diarias` — no duplicar reglas de ese sistema
acá, solo referenciarlas si hace falta contexto.

Última actualización: 2026-11-16.

---

## 0. Separación de repos (2026-11-16)

Hasta el 2026-11-16, este dashboard (`dashboard/beta/`) y los scripts de
ingesta vivían dentro del repo `mercadopacks-metricas-diarias`, junto con
el pipeline de producción (Firestore). Se separaron en dos repos:

- **`Mercadopacks/Sistema`** (este repo): el dashboard (`index.html` +
  `assets/`), publicado en `https://mercadopacks.github.io/Sistema/`, y
  **todos** los scripts/infra de ingesta a Supabase (`scripts/`,
  `supabase/functions/`, el workflow de GitHub Actions).
- **`Mercadopacks/mercadopacks-metricas-diarias`**: el dashboard de
  producción (Firestore) y su propio pipeline de ingesta
  (`publicar_firestore.py`, `descarga_diaria.yml`).

**Por qué importa esto para el día a día:** `descargar_lightdata.py`,
`fecha_descarga.py` y `generar_reporte.py` de la carpeta `scripts/` de
este repo son **copias deliberadas** de los mismos archivos del otro
repo — no un submódulo, no un paquete compartido. Cada repo tiene su
propia copia del scraper.

**Cuentas de LightData separadas (2026-11-16, decisión del usuario):**
este pipeline usa una cuenta de LightData **propia y distinta** de la
que usa `descarga_diaria.yml` en el otro repo — los secrets
`LIGHTDATA_USER`/`LIGHTDATA_PASS` de este repo tienen que cargarse con
ese login dedicado, nunca con las credenciales de producción. Antes de
esto, los dos pipelines compartían la misma cuenta y un `concurrency
group` de GitHub Actions (que solo funciona dentro de un mismo repo)
evitaba que se pisaran logueándose al mismo tiempo — al separar los
repos ese mecanismo dejó de servir, y hubo un timeout real de Playwright
por esto (documentado en el otro repo, antes de la separación). Con
cuentas distintas, ese riesgo queda eliminado de raíz: cada sesión de
Playwright es independiente, no hay sesión compartida que se pueda pisar
— no hace falta coordinar horarios entre los dos repos.

**Si LightData cambia el formato del export, el flujo de login, o
cualquier selector de Playwright**, el fix hay que aplicarlo a mano en
**los dos repos** — no hay sincronización automática entre las copias.

---

## 1. Reglas de diseño del dashboard (`index.html`)

Estándar fijo desde 2026-11-15 (no una preferencia de un módulo puntual
— se definió después de que el primer ABM de Administración se armó mal
y hubo que rehacerlo entero). Todo ABM nuevo (listado con alta/edición/
borrado) sigue esto:

1. **Filas en modo lectura** (texto plano), nunca `<input>` sueltos
   editables en cada celda.
2. **Última columna = "Opciones"**, alineada a la derecha, con dos
   íconos Lucide: lápiz para editar, tacho para borrar. Nada de edición
   inline ni un solo botón "borrar" suelto.
3. **Alta y edición abren el mismo modal** (overlay + tarjeta centrada),
   con los campos precargados si es edición, y dos botones: **Guardar**
   y **Cerrar**. Nunca `prompt()` del navegador.
4. **Cualquier campo de opciones fijas usa su propio ABM**, no texto
   libre — si algo se repite entre registros (vehículo, zona, turno,
   localidad), es su propia tabla de parámetros, referenciada con un
   combo (`crearComboGenerico`/`crearMultiSelectGenerico`), nunca un
   `<input type="text">` libre para un dato que viene de una lista
   cerrada.
5. **Alineación**: texto a la izquierda, números/checkboxes centrados,
   "Opciones" siempre a la derecha — revisarlo visualmente antes de dar
   algo por terminado.
6. **Buscador + botón de alta en la misma fila** (`.buscar-mas-filtrar`).
7. **Cualquier elemento que el `<script>` engancha con `addEventListener`
   al nivel superior tiene que estar en el HTML ANTES del `<script>`**
   (si se agrega después, en el momento en que el script corre ese
   elemento todavía no existe — error real ya visto: `Cannot read
   properties of null`, que además corta TODO el script top-level sin
   ejecutarse).
8. **Todo combo/popover flotante usa el singleton compartido
   `crearComboGenerico`/`crearPopoverGenerico`** — nunca una variable
   `yaAbierto`/`hidden` aislada por componente (si no comparten el mismo
   "¿hay algo abierto ahora?", abrir uno no cierra el otro).
9. **Botón con ícono + texto siempre en una sola línea horizontal**
   (regla base sobre `button`: `display:inline-flex; align-items:center;
   gap:7px`) — nunca parchear un botón puntual con su propio
   `display:flex`.
10. **Todo combo/multiselect se comporta como un `<select>` nativo**:
    clickear una opción siempre cierra la lista, y ↑/↓/Home/End/Enter/
    Escape navegan y confirman por teclado.
11. **Solo el contenido real (texto de celda, de detalle) es
    seleccionable con el mouse** — botones, títulos, chips, íconos,
    menús NO (`user-select:none` en `body`, reactivado puntualmente).
12. **Un `<label>` solo puede envolver el control que literalmente le
    pertenece** (un checkbox, un `<input>` de texto) — NUNCA un combo
    propio ni nada con una lista/panel adentro (un click dentro de un
    `<label>` se reenvía automáticamente a su primer control "labelable",
    así que clickear una opción del combo reabre la lista).
13. **Todo `const`/`let` que use una función compartida (ej. un registro,
    un cache, un singleton) se declara ARRIBA DE TODO el `<script>`**, no
    "justo antes" de la función que lo usa — un `const` no se "hoistea"
    con valor como una función declarada (`function foo(){}` sí queda
    disponible desde el principio del script, pero el `const` de arriba
    suyo no se inicializa hasta que esa línea corre). Si otro módulo más
    arriba en el archivo ya llama a esa función antes de llegar a esa
    línea, explota con `ReferenceError: Cannot access '...' before
    initialization` **apenas carga la página, cortando TODO el `<script>`
    sin ejecutarse** — no es un error aislado de un módulo, rompe TODA la
    app (bug real 2026-11-18: `registroCombos` declarado junto a
    `crearComboGenerico`, pero Fallidos ya la llamaba más arriba en el
    archivo).
14. **Antes de dar un cambio de JS por terminado, hay que EJECUTARLO de
    verdad, no solo chequear que no tenga errores de sintaxis** (`new
    Function(codigo)` solo parsea, no corre nada, y no detecta este tipo
    de bug). Correr el script completo con jsdom (navegador simulado) y
    mocks mínimos de `supabase`/`lucide`, confirmando que llega al final
    sin tirar una excepción top-level — es la única forma de agarrar este
    tipo de error antes de que lo vea el usuario. Ver el changelog
    2026-11-18 para un ejemplo concreto del comando.

**Excepción explícita — pantallas operativas "en vivo"** (ej. una
pantalla tipo "Asistencia de hoy" donde varias personas van tildando
casillas de la misma fila durante el día): ahí la edición inline sigue
siendo correcta a propósito — exigir un modal por cada tilde sería
impracticable. La diferencia es el tipo de pantalla: gestión de
registros maestros (ABM) vs. tablero operativo del día. Ante la duda,
preguntar antes de asumir cuál aplica.

**Otras reglas visuales fijas de este dashboard** (a diferencia del de
producción, que no las usa):
- Fuente: **Nunito** (Google Fonts).
- Íconos: librería **Lucide** (`data-lucide="nombre"` +
  `lucide.createIcons()`), nunca emojis como ícono.
- Navegación: **sidebar lateral** desplegable/colapsable.
- Botones de acción secundaria (ej. cerrar sesión): ícono solo, sin
  texto.
- Paleta: dorado `#F6BE05` + negro, fondo `#efeeea`, tarjetas blancas.
- **Campos de entrada vs. chips — nunca mezclar los dos estilos**:
  - **Chips** (opciones seleccionables, ej. Hoy/Ayer/Rango): forma de
    "pastilla", `border-radius:20px`.
  - **Campos de entrada** (fecha, buscador, texto): esquinas rectas
    `border-radius:8px`, fondo blanco, borde `1px solid var(--borde)`,
    nunca forma de pastilla.
  - Todo elemento dentro de una fila de chips comparte `height:36px` y
    el contenedor lleva `align-items:center`.
  - La regla de `input[type="date"]` se define UNA sola vez como
    selector global de tipo, no por cada id de contenedor nuevo.
  - **Filtro de columna con opciones fijas = combo propio, NUNCA
    `<select>` nativo** (un `<select>` no se puede re-estilar en su
    estado abierto en ningún navegador) — usar
    `.combo-filtro`/`.combo-filtro-btn`/`.combo-filtro-lista`. Un filtro
    de texto libre sigue usando `input[type="text"]` normal.

---

## 2. Base de datos (Supabase, proyecto separado del de producción)

- **`envios`**: una fila por envío, clave real `id_interno` (columna
  `ID (Interno)` del export de LightData — el `Número Tracking` NO es
  único, puede repetirse). Columnas tipadas para lo que se usa
  activamente (`tracking`, `cliente`, `localidad`, `zona`, `estado`,
  `cadete`, `chofer_lightdata_id`, `fecha_mercadopacks`, `fecha_estado`,
  `fecha_asignacion`, `fecha_a_planta`, `logistica_inversa`,
  `observaciones`) + columna `raw jsonb` con las columnas completas del
  export tal cual vienen (incluye datos personales del destinatario —
  decisión del usuario: se guardan, protegidos por RLS, a diferencia de
  Firestore donde se excluyen). `chofer_lightdata_id` es el ID real del
  repartidor en Lightdata (`didcadete`, ver `lightdata_api_envios.md`),
  sin FK a propósito (no debe bloquear la publicación si todavía no
  sincronizó ese repartidor) — se completa por `vincular_choferes_envios.py`
  para envíos nuevos y se backfillea una vez para los viejos
  (`scripts/backfill_chofer_lightdata_id.py`, por nombre normalizado, no
  resuelve homónimos). ~46MB para ~24k filas (sobre todo por `raw`) y
  sigue creciendo sin tope — no hay archivado/particionado todavía,
  pendiente si en algún momento pesa en performance o costo.
- **`envios_historial`**: existió pero se borró (auditoría 2026-11-19) —
  tenía índices/FK/RLS armados pero nada en el código la leía ni escribía
  nunca. Si en el futuro hace falta trazabilidad de cambios de estado/
  cadete, hay que armarla de nuevo con un trigger real, no asumir que ya
  existe.
- **`perfiles_usuario`**: metadata de cada usuario del dashboard
  (nombre, apellido, email, sector, `es_admin`, `activo`,
  `vistas_permitidas text[]`), enlazada 1 a 1 con `auth.users` por
  `auth_user_id`. **INSERT no está habilitado para `authenticated`** —
  el alta de un usuario nuevo SIEMPRE pasa por la Edge Function
  `crear-usuario` (único lugar con permiso para crear la cuenta de Auth
  + el perfil, usando la service role key). La edición de un perfil
  existente (sector/vistas/admin/activo) SÍ es un `.update()` directo
  desde el cliente, protegido por una política RLS que exige que quien
  edita tenga `es_admin=true` en su propio perfil.
- **`fallidos_seguimiento`**: seguimiento manual de casos de Fallidos/
  Cambios (`id_interno` no es único a propósito — un duplicado genera
  una segunda fila con `duplicado=true` referenciando el mismo envío).
  Un envío fallido/cambio que nadie tocó todavía NO tiene fila acá — se
  cruza en vivo con `envios` filtrado por `parametros_fallidos_mapeo`
  (ver sección 3). Desde la auditoría 2026-11-19 tiene `updated_at`/
  `actualizado_por` (trigger automático — queda registrado quién y
  cuándo tocó un caso por última vez, incluido el escaneo QR).
- **`parametros_fallidos_mapeo`** / **`parametros_alertas_fallidos`**:
  tablas de configuración editables desde Administración (ABM simple).
- **`choferes_roster.nombre` es `UNIQUE`** — el nombre sigue siendo la
  clave de identidad para el alta manual, aunque ya existe un
  identificador real (`lightdata_id`). Es la razón de fondo por la que
  `sincronizar_lightdata.py` tiene que tratar homónimos a mano en vez de
  vincularlos solo. Deuda técnica documentada (auditoría 2026-11-19), no
  se tocó todavía por el riesgo de habilitar altas duplicadas sin un
  beneficio inmediato claro.
- **Repartidores se cruzan por `lightdata_id`, no por nombre** (ver
  sección 0 y el changelog 2026-11-18/19): `choferes_roster.lightdata_id`
  (FK a `lightdata_usuarios`), `asistencia_diaria.lightdata_id` (FK
  también desde 2026-11-19, se copia del roster al cargar un día) y
  `envios.chofer_lightdata_id` (sin FK, ver arriba) son el mismo ID.
  Cualquier cruce nuevo entre estas tablas tiene que usar este ID primero
  y nombre normalizado (`normalizar`/`normEspaciosNombre`) solo como
  respaldo — nunca comparar nombres a secas, Lightdata mete espacios
  dobles/inconsistencias reales (caso "Fiorella  Souza").
- RLS activado en todas las tablas desde que se creó cada una. Service
  role (usado por los scripts de `scripts/` y la Edge Function) tiene
  permiso total vía `GRANT` explícito — **ojo**: un `GRANT` de tabla y
  una policy de RLS son dos cosas separadas; falta el `GRANT` a un rol
  (incluido `service_role`) tira "permission denied" aunque la policy ya
  esté bien (error real 2026-11-16 con `perfiles_usuario`, repetido
  2026-11-18 con `fallidos_seguimiento`/`parametros_fallidos_mapeo`/
  `parametros_alertas_fallidos`). El rol `authenticated` solo tiene los
  `GRANT`/policies que cada tabla declara explícitamente en su migración
  — nunca asumir que hereda algo de otra tabla. `anon` no tiene ningún
  privilegio en ninguna tabla (login 100% Supabase Auth, revocado
  explícito en la auditoría 2026-11-19).
- **RLS por vista, no solo por estar logueado** (desde la auditoría
  2026-11-19): la función `tiene_permiso_vista(vista)` (replica exacto
  `puedeVerVista()` del frontend — admin ve todo, sin perfil = fail-open)
  gobierna la ESCRITURA de `parametros_*`/`choferes_roster` (vista
  `admin`), `fallidos_seguimiento` (vista `fallidos`) y `asistencia_diaria`
  (vista `repa-asistencia`). La LECTURA de esas mismas tablas se deja
  abierta a cualquier `authenticated` donde hace falta para combos/
  dropdowns de otras pantallas (ej. Asistencia necesita leer
  `parametros_vehiculos` aunque el usuario no tenga la vista `admin`).
  Antes de esto, `vistas_permitidas` era 100% cosmético: ocultaba el
  menú, pero cualquier usuario logueado podía leer/escribir cualquier
  tabla por API directa sin que la UI lo permitiera ver. Si se agrega una
  tabla nueva con escritura sensible, replicar este patrón, no asumir
  que "requiere login" alcanza.
- Auth: registro público desactivado (`Allow new users to sign up`
  off). Login con email+contraseña.

---

## 3. Fallidos y Cambios

Pantalla principal: **"Por repartidor"** — un repartidor por fila (solo
los que tienen casos *pendientes*), con conteo de Fallidos/Cambios y el
caso más antiguo de cada uno, ordenado por antigüedad descendente.
Clickear un repartidor muestra el detalle de sus casos pendientes (mismo
orden). Pestaña **"Todos"**: el listado plano completo, filtrable por
Tipo (Fallido/Cambio), Destino, Estatus y antigüedad.

Reglas de negocio confirmadas con el usuario (2026-11-16):

- **Antigüedad = hoy − `fecha_mercadopacks`** (fecha de ingreso al
  depósito), NUNCA `fecha_estado` — ese campo se actualiza con cada
  cambio de estado y no sirve para medir cuánto tiempo lleva un paquete
  sin entregar.
- **El `Estado` de LightData NO define un Cambio.** Describe el paquete
  NUEVO que se entrega, no si el chofer ya devolvió el producto
  ORIGINAL — un paquete de cambio normalmente figura como "Entregado" o
  "En camino" en Lightdata (el estado del envío nuevo), aunque el
  original todavía no haya vuelto. La señal real de que algo es un
  Cambio es: `Logistica Inversa` tiene cualquier valor no vacío, O
  `Observaciones` menciona "cambio" (sin importar mayúsculas). Estas
  señales hacen que el paquete entre a la lista de seguimiento **incluso
  si su Estado no es ninguno de los mapeados como Fallido** en
  `parametros_fallidos_mapeo`.
- **Duplicados** (mismo paquete físico, un solo ID de Lightdata): se
  buscan por tracking/cliente/localidad y se marcan sobre el envío
  existente (segunda fila en `fallidos_seguimiento` con
  `duplicado=true`), nunca se re-cargan datos a mano.
- Semáforo de días (`parametros_alertas_fallidos`): Normal → Pedir
  (`pedir` días) → Prioridad (`prioridad` días) → Revisar (`revisar`
  días), en ese orden ascendente.

---

## 4. Usuarios y permisos por vista

- Login 100% Supabase Auth — `perfiles_usuario` es solo metadata (ver
  sección 2).
- **Alta de usuario** = llamar a la Edge Function `crear-usuario`
  (`supabase/functions/crear-usuario/index.ts`), nunca insertar la
  tabla directo. La función valida que quien llama tenga
  `es_admin=true` en su propio perfil ANTES de crear nada (si no,
  cualquier usuario logueado podría invocarla igual — es un endpoint
  público, protegido solo por pedir un JWT válido — y darse de alta a
  sí mismo como admin).
- **Edición de permisos** de un usuario existente = `.update()` directo
  desde el cliente, protegido por la policy RLS de `perfiles_usuario`
  (solo un admin puede editar cualquier perfil, incluido el suyo).
- **Un admin (`es_admin=true`) ve todas las vistas**, sin importar lo
  que diga `vistas_permitidas` — ese array solo aplica a usuarios no
  admin.
- **Fail-open deliberado**: un usuario autenticado SIN perfil en
  `perfiles_usuario` todavía (ej. una cuenta vieja de antes de este
  sistema de permisos) ve TODO el sidebar, en vez de quedar bloqueado —
  para no dejar a nadie sin acceso el día que se activó esto. Hay que
  darle de alta su perfil desde Administración > Usuarios para que sus
  permisos queden acotados de verdad.
- `activo=false` fuerza el logout inmediato en el próximo chequeo de
  sesión (no revoca la sesión de Supabase Auth en sí, es un chequeo del
  lado del cliente).

---

## 5. Componentes de UI reutilizables (JS, dentro de `index.html`)

- `crearComboGenerico(contenedorId, onSeleccionar)` / `crearPopoverGenerico(id)`
  / `crearMultiSelectGenerico(id)`: singleton compartido para cualquier
  combo/popover flotante — todos cierran sus hermanos al abrirse
  (`pilaFlotantes`), y se cierran solos al clickear afuera.
- `abrirModalAbm(titulo, campos, valores, onGuardar)`: modal genérico de
  alta/edición. `campos` acepta tipos `texto`/`number`/`time`/
  `checkbox`/`select`/`multiselect`, y un `mostrarSi: (valoresActuales) =>
  boolean` opcional por campo (para campos condicionales, ej. "Precio a
  descontar" solo si el Estatus elegido es "Descontar al chofer").
  `onGuardar` puede devolver `false` para dejar el modal abierto (ej.
  falló una validación o el guardado) — cualquier otro valor de retorno
  cierra el modal como siempre. El botón "Guardar" se deshabilita y
  muestra "Guardando…" mientras `onGuardar` está pendiente.
- `crearAbmSimple({tabla, tbodyId, buscarId, btnAgregarId, titulo, orden})`:
  fábrica para ABMs de solo id+nombre+activo (Vehículos, Zonas,
  Localidades).
- `mostrarAviso(texto)` / `mostrarConfirmacion(texto)`: reemplazan
  `alert()`/`confirm()` nativos (que muestran el nombre del host y
  rompen el diseño) por el mismo modal-overlay del resto del sistema.

---

## 6. Changelog

| Fecha | Cambio |
|---|---|
| 2026-11-15 | Arranca el ecosistema sobre Supabase (`dashboard/beta/` en ese momento, dentro del repo de producción). Login + "Seguimiento de Envíos" (KPIs + tabla de últimos cambios). |
| 2026-11-16 | Módulo Fallidos y Cambios: vista "Por repartidor" + vista "Todos", clasificación de Cambio por señal (Logistica Inversa/Observaciones) en vez de por Estado, duplicados por búsqueda. |
| 2026-11-16 | Alta de usuarios + permisos por vista: tabla `perfiles_usuario`, Edge Function `crear-usuario`, fail-open para cuentas sin perfil todavía. |
| 2026-11-16 | Reorganización del sidebar: "Configuración" pasa a ser un solo ítem con su propio submenú DENTRO de la pantalla (antes duplicaba navegación con chips internos); sidebar con scroll independiente del contenido; grupo "Seguimiento de Repartidores" colapsable. |
| 2026-11-16 | Fix genérico en `abrirModalAbm`: ya no se cierra ni pierde los datos cargados cuando falla una validación o un guardado (afecta a los 13 modales del sistema). |
| 2026-11-16 | `publicar_supabase.yml` pasa de disparo manual a automatizado (cron-job.org, cada 10 min en horario operativo). |
| 2026-11-16 | Separación de repos: dashboard + scripts de ingesta pasan del repo de producción a este repo (`Mercadopacks/Sistema`), ver sección 0. |
| 2026-11-16 | Cuenta de LightData propia y distinta de la de producción — elimina de raíz el riesgo de choque de Playwright entre los dos pipelines (ver sección 0). |
| 2026-11-17 | El alta de repartidores queda centralizada en el ABM (Configuración → Repartidores): el botón "Agregar chofer" de Asistencia ya no deja tipear un nombre nuevo, solo elegir uno existente del roster. |
| 2026-11-17 | Estandarización de nombres: toda la UI dice "Repartidor" en vez de "Chofer" (los nombres internos de tabla/función — `choferes_roster`, etc. — no cambiaron, solo el texto visible). |
| 2026-11-17 | `sincronizar_lightdata.py`: nueva integración (ver `integracion_usuarios_lightdata.md`) que trae el listado de usuarios de Lightdata y crea/vincula repartidores en `choferes_roster` automáticamente, marcando `pendiente_completar` a los que faltan datos propios (vehículo/zona/turno/localidad). Dos modos: `--live` (pega al endpoint interno de Lightdata vía Playwright, corre como paso extra de `publicar_supabase.yml` con `continue-on-error` porque es un endpoint no oficial) o un .xlsx manual de respaldo. Matching por nombre normalizado, nunca por nombre exacto — ver sección 4.3 del .md de integración. |
| 2026-11-18 | Borrado de datos de prueba: ~4100 envíos (+ su `envios_historial`/`fallidos_seguimiento`) con `fecha_mercadopacks` anterior al último mes, para probar Fallidos y Cambios con un dataset acotado. De paso, mismo fix de `GRANT` que `perfiles_usuario` (sección 2) pero en `fallidos_seguimiento`, que nunca lo tuvo para `service_role`. |
| 2026-11-18 | Fallidos y Cambios → "Por repartidor": el detalle de un repartidor pasa a ser un modal (`#modal-detalle-fallidos`) en vez de reemplazar la pantalla — antes se mezclaba visualmente con la pestaña "Todos" porque compartían la misma tarjeta/tabla. |
| 2026-11-18 | Escaneo por pistola QR/código de barras en el detalle de un repartidor: marca "Recibido en planta" al instante. Reusa la misma extracción de ID que el sector de Picking (Google Apps Script) — `did` → Directo/`id_interno`, `tracking_number`/`id` → Mercadolibre/`tracking`. |
| 2026-11-18 | Botón global "Limpiar filtros" en cualquier `.panel-filtros-ruta` que tenga combos adentro (`crearPopoverGenerico`/`agregarLimpiarFiltros` — ver sección 1, regla 13 sobre el bug de orden de declaración que esto mismo introdujo y cómo evitarlo). |
| 2026-11-18 | Buscador automático en cualquier combo con más de `UMBRAL_BUSCADOR_COMBO` (8) opciones — global, no hay que activarlo por módulo (ver `crearComboGenerico`). |
| 2026-11-18 | "Tiene fallidos"/"Fallidos recibidos" de Asistencia dejaron de ser checkboxes manuales: se calculan en vivo contra los pendientes de Fallidos y Cambios de ese repartidor (`contarFallidosPendientesPorRepartidor`). |
| 2026-11-18 | **Cruzar repartidores por ID de Lightdata, no por nombre** (bug real: "Fiorella  Souza" con doble espacio en `envios.cadete` no matcheaba contra "Fiorella Souza" del roster/Asistencia). Ver `lightdata_api_envios.md` (endpoint de envíos, trae `didcadete`) y `scripts/vincular_choferes_envios.py` (completa `envios.chofer_lightdata_id` — mismo ID que `lightdata_usuarios.lightdata_id`/`choferes_roster.lightdata_id`). `asistencia_diaria.lightdata_id` se copia del roster al cargar un repartidor para un día. El frontend cruza por ID cuando está disponible en los dos lados (`claveRepartidorEnvio`/`claveRepartidorAsistencia`) y cae a nombre normalizado solo como respaldo para datos de antes de este cambio (no se hizo backfill histórico todavía, queda pendiente para una migración posterior). |
| 2026-11-19 | **Auditoría completa de arquitectura de base de datos** (migración `2026-11-19_auditoria_arquitectura.sql`): (1) borrado un índice duplicado sobre `envios.fecha_mercadopacks` (bug propio del 18/11); (2) borradas `asistencia_diaria.estado_chofer`/`alertado` y la tabla `envios_historial` completa — nada en el código los usaba; (3) agregada FK `asistencia_diaria.lightdata_id` → `lightdata_usuarios.lightdata_id` (ya existía en `choferes_roster`, faltaba acá); (4) `fallidos_seguimiento` ahora tiene `updated_at`/`actualizado_por` (trigger automático, no depende del frontend) para poder auditar quién tocó un caso; (5) **RLS por vista real**: hasta ahora cualquier usuario logueado podía escribir en cualquier tabla vía API aunque `vistas_permitidas` no le diera esa vista — el permiso por vista era 100% cosmético (solo ocultaba el menú). La función `tiene_permiso_vista(vista)` replica exacto el criterio de `puedeVerVista()` del frontend (admin ve todo, sin perfil = fail-open) y ahora las policies de escritura de `parametros_*`/`choferes_roster` (vista `admin`), `fallidos_seguimiento` (vista `fallidos`) y `asistencia_diaria` (vista `repa-asistencia`) la usan de verdad; lectura se deja abierta a cualquier autenticado donde hacía falta para combos/dropdowns de otras pantallas; (6) revocados los privilegios por defecto de `anon` en todas las tablas (nunca se usa, login 100% Supabase Auth). Backfill de `chofer_lightdata_id` corrido sobre los ~22.600 envíos previos a la vinculación por ID: 19.578 resueltos por nombre normalizado (82,9%), el resto queda con homónimos ambiguos o sin cadete asignado (no se adivina). **Bug encontrado al hacer el backfill**: un upsert parcial de supabase-py (solo `id_interno` + `chofer_lightdata_id`, sin el resto de columnas NOT NULL) le erraba siempre al `ON CONFLICT` e intentaba insertar una fila incompleta — se reemplazó por la función `actualizar_chofer_lightdata_id_lote(ids, valores)` (UPDATE real vía `unnest`, un solo viaje por lote de 500), usada ahora tanto en `vincular_choferes_envios.py` como en `scripts/backfill_chofer_lightdata_id.py`. Decisión explícita: NO se relajó el `UNIQUE` de `choferes_roster.nombre` (es la causa de fondo de por qué `sincronizar_lightdata.py` tiene que tratar homónimos a mano) — queda como deuda técnica documentada, no se tocó por el riesgo de habilitar altas manuales duplicadas sin un beneficio inmediato claro. |
