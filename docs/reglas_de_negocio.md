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
15. **Todo texto libre que venga de la base (Lightdata/Excel, no texto
    cargado a mano por un usuario del sistema) se muestra en pantalla
    pasado por `tituloTexto()`** (Primera Letra Mayúscula, resto
    minúscula) — Lightdata trae una mezcla de MAYÚSCULAS, minúsculas y
    Mixto sin ningún criterio (pedido 2026-11-19, mismo criterio que ya
    se aplicaba solo a nombres de repartidor con `tituloNombre()`, que
    ahora es un alias de la misma función). Aplica a cliente, localidad,
    zona, origen, estado, y cualquier campo nuevo por el estilo — NUNCA
    al valor usado para comparar/filtrar/agrupar (`f.envio.estado ===
    "A retirar"`, `.in("estado", estados)`, etc.), eso sigue siendo
    con el valor crudo tal cual lo guarda la base, solo cambia lo que
    se VE en el `<td>`. Excepción: texto cargado a mano en el sistema
    (observaciones de un caso de Fallidos, motivo de cierre, etc.) se
    muestra tal cual lo escribió la persona, sin tocar.
16. **Toda vista que lista datos consulta solo lo que necesita, no "todo
    por si acaso"** (pedido 2026-11-21, ver changelog). En la práctica:
    - **Nunca `select("*")` cuando se usan solo algunas columnas** —
      pedir explícito `select("col1,col2,...")`.
    - **Las tablas de PARÁMETROS de Configuración (ABMs chicos: Zonas,
      Vehículos, Turnos, Cordones, Tamaños de paquete, Sectores — todas
      con menos de ~50 filas) se piden UNA vez por sesión**, no cada vez
      que se entra a esa pantalla — `crearAbmSimple()`/
      `crearAbmLocalidades()` guardan un flag `cargado` y saltean el
      fetch si ya se cargaron (alta/edición/borrado actualizan el array
      en memoria a mano, nunca hace falta re-pedir después de esas
      acciones). Esto NO aplica a datos operativos que cambian solos en
      el fondo (envíos, fallidos) — esos sí se vuelven a pedir cada vez.
    - **Un dato "pesado" que solo hace falta en el DETALLE de una fila no
      se pide para TODA la lista** — ejemplo real: la grilla de Clientes
      solo necesita la CANTIDAD de cuentas vinculadas por cliente (se
      puede pedir pidiendo solo la columna `did_cliente`, sin las otras
      6 columnas de IDs externos); las cuentas completas de un cliente
      se piden recién al abrir su "Ver detalle", no las de los 296
      clientes de entrada.
    - **Pantallas con una tabla que puede crecer sin límite** (Envíos,
      Fallidos y Cambios) usan paginado real contra la base
      (`select(..., {count:"exact"})` + `.range()`), no cargan todo y
      paginan en memoria — ver "Envíos" (`cargarEnviosListado()`) como
      referencia. Una tabla de Configuración chica (parámetros) NO
      necesita este paginado — agregárselo sería complejidad sin
      beneficio real (ver changelog 2026-11-21 para el análisis de
      tamaños que justificó esta distinción, en vez de paginar todo por
      igual).

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
- Paleta: dorado `#F5B106` (Manual de Marca Mercado Packs) + negro, fondo `#efeeea`, tarjetas blancas.
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

**Antes de borrar CUALQUIER tabla/columna por "no tiene uso"**: un `grep`
sobre `index.html`/`scripts/*.py` SOLO confirma que la aplicación no la
usa — no dice nada sobre si hay un **trigger o función de Postgres**
escribiendo ahí. Bug real 2026-11-19: `envios_historial` se borró en la
auditoría de arquitectura asumiendo que estaba muerta (grep limpio), pero
tenía un trigger real en `envios` que la alimentaba en cada
insert/update — rompió TODA la publicación de envíos en producción hasta
que se detectó y se borró el trigger (no hacía falta resucitar la tabla,
nada la leía). Antes de un `drop table`/`drop column`, correr esto en el
SQL Editor y confirmar que no aparece nada:

```sql
select event_object_table, trigger_name from information_schema.triggers
where trigger_schema = 'public';

select proname from pg_proc where pronamespace = 'public'::regnamespace
  and prosrc ilike '%nombre_de_lo_que_vas_a_borrar%';
```

- **`envios`**: una fila por envío, clave real `id_interno` (columna
  `ID (Interno)` del export de LightData — el `Número Tracking` NO es
  único, puede repetirse). **Ya NO tiene columna `raw`** (borrada en la
  auditoría 2026-11-19 — pesaba 46MB de los ~46MB totales de la tabla,
  bajó a 12MB después del `VACUUM FULL`): todo lo que traía el Excel ahora
  es columna propia — `tracking`, `cliente`, `localidad`, `zona`,
  `estado`, `cadete`, `fecha_mercadopacks`, `fecha_estado`,
  `fecha_asignacion`, `fecha_a_planta`, `logistica_inversa`,
  `observaciones`, `cp`, `origen`, `precio`, `provincia`, `cod_cliente`,
  `fecha_venta`, `id_venta_ml`, `zona_precio`, `quien_estado`,
  `razon_social`, `url_tracking`, `fecha_colecta`, `nombre_cuenta`,
  `usuario_ml_id`, `tipo_direccion`, `total_a_cobrar`, `metodo_envio`,
  `comentario_destino` — salvo los 5 campos sensibles del destinatario
  (`Nombre Destinatario`, `Dirección`, `Tel.`, `Email`, `Latitud`/
  `Longitud`), que viven en `envios_contacto_destinatario` (ver abajo).
  `chofer_lightdata_id` / `logistica_inversa_real` / `estado_ml` /
  `did_cliente` vienen del endpoint JSON de envíos en vivo (no del Excel —
  ver `lightdata_api_envios.md`), completados por
  `vincular_choferes_envios.py` para envíos del día; sin FK a propósito en
  `chofer_lightdata_id` (no debe bloquear la publicación si todavía no
  sincronizó ese repartidor). `logistica_inversa` (texto libre, viejo)
  sigue existiendo como respaldo solo para envíos cuyo
  `logistica_inversa_real` todavía es null.
- **`envios_contacto_destinatario`**: 1 a 1 con `envios` por `id_interno`
  (`on delete cascade`). Los 5 campos sensibles de arriba. **RLS activado,
  SIN policy para `authenticated`** — a propósito: RLS es por fila, no por
  columna, así que la única forma real de esconder un dato sensible que
  viajaba en la misma fila es separarlo en otra tabla con su propia
  policy. Hoy nada de la UI lo necesita, así que queda cerrado (solo
  `service_role` puede leerlo/escribirlo) hasta que haga falta una
  pantalla puntual — ahí se agrega una policy gateada por
  `tiene_permiso_vista()`, nunca "estar logueado" nomás.
- **`envios_historial`**: existió pero se borró (auditoría 2026-11-19) —
  tenía índices/FK/RLS armados pero nada en el código la leía ni escribía
  nunca. Si en el futuro hace falta trazabilidad de cambios de estado/
  cadete, hay que armarla de nuevo con un trigger real, no asumir que ya
  existe.
- **`perfiles_usuario`**: metadata de cada usuario del dashboard
  (nombre, apellido, email, `es_admin`, `activo`,
  `vistas_permitidas text[]`), enlazada 1 a 1 con `auth.users` por
  `auth_user_id`. **INSERT no está habilitado para `authenticated`** —
  el alta de un usuario nuevo SIEMPRE pasa por la Edge Function
  `crear-usuario` (único lugar con permiso para crear la cuenta de Auth
  + el perfil, usando la service role key). La edición de un perfil
  existente (tipo/sector/clientes/vistas/admin/activo) SÍ es un
  `.update()` directo desde el cliente, protegido por una política RLS
  que exige que quien edita tenga `es_admin=true` en su propio perfil.
  Desde 2026-11-20 (ver changelog) tiene `tipo_usuario`
  ("administrativo"/"cliente"), `sector_id` (FK a `parametros_sectores`,
  solo para administrativo) y `clientes_lightdata_ids bigint[]` (solo
  para cliente, FK lógica a `lightdata_clientes.did`) — el viejo `sector`
  de texto libre queda deprecado (columna sin borrar, por las dudas).
- **`lightdata_clientes`**: sincronizada por
  `scripts/ingesta_lightdata/sincronizar_clientes_lightdata.py` (1 vez
  por día, endpoint `getClientes` — ver `lightdata_api_clientes.md`),
  `did` como PK. Solo tiene los campos que necesita el combo del ABM de
  Usuarios (`codigo`, `nombre_fantasia`, `razon_social`, `habilitado`) —
  no el modelo completo de contactos/direcciones/cuentas que documenta
  el `.md`, se amplía si hace falta a futuro (ej. liquidación de
  clientes). Lectura abierta a `authenticated`, escritura solo
  `service_role`.
- **`parametros_sectores`**: lista cerrada de sectores (id, nombre,
  activo) — reemplaza el `sector` de texto libre de `perfiles_usuario`
  (Regla 4 de sección 1: opciones fijas = su propia tabla). ABM simple
  en Configuración → Sectores, misma fábrica `crearAbmSimple()` que
  Vehículos/Zonas/Localidades.
- **`parametros_tamanos_paquete`** / **`parametros_cordones`**: ABMs
  simples (`crearAbmSimple()`) para Pequeño/Mediano/Grande y CABA/GBA1/
  GBA2/GBA3 — se usan como FK en el tarifario de `precios_cliente_envio`/
  `precios_cliente_flete` (ver changelog 2026-11-20, "Precios por
  Cliente").
- **`parametros_localidades`** pasa a tener `zona`/`cp`/`cordon_id`
  (unificación con la vieja `parametros_zonas`, que queda deprecada sin
  ABM propio — ver changelog 2026-11-20).
- **`precios_cliente`** (cabecera, 1 fila por `did_cliente`) +
  **`precios_cliente_envio`** (precio por tamaño × cordón) +
  **`precios_cliente_flete`** (precio por cordón): tarifario comercial
  por cliente, RLS acotada a la vista "admin" (ni lectura ni escritura
  para usuarios tipo Cliente) — ver changelog 2026-11-20.
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
- **Acceso por cliente (desde 2026-11-20)**: un usuario `tipo_usuario='cliente'`
  solo puede LEER los envíos de los `clientes_lightdata_ids` que tiene
  asociados (vía `envios.did_cliente`) — administrativo/admin ven todo,
  igual que siempre. Esto se implementa con policies **RESTRICTIVAS**
  (`as restrictive`, no el default permisivo) sobre `envios`,
  `envios_contacto_destinatario` y `fallidos_seguimiento`, usando la
  función `puede_ver_envio_de_cliente(did_cliente)`. Importante: una
  policy restrictiva se combina con AND con cualquier policy permisiva
  que ya exista en la tabla (en vez de OR, como pasa entre permisivas) —
  es la única forma de ESTRECHAR acceso sin tener que conocer ni tocar
  la policy permisiva original (que no está en ninguna migración
  rastreada, se armó a mano antes de esta carpeta). Si se agrega una
  tabla nueva con datos propios de un cliente, replicar esta misma
  policy restrictiva ahí también — agregar solo una policy "más" sin
  `as restrictive` NO alcanza, porque se combina por OR y la permisiva
  vieja sigue dejando ver todo.
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
- **`tipo_usuario` (desde 2026-11-20)**: "administrativo" (personal de
  la empresa, ve todos los envíos sin importar `clientes_lightdata_ids`)
  o "cliente" (acotado a los `clientes_lightdata_ids` que tenga
  asociados — ver sección 2, "Acceso por cliente"). Es ortogonal a
  `vistas_permitidas`/`es_admin`: un usuario tipo Cliente sigue
  necesitando la vista correspondiente habilitada (ej. `envios`) para
  verla en el sidebar — `tipo_usuario` decide QUÉ datos ve dentro de esa
  vista, no si la vista aparece. El ABM de Usuarios exige al menos un
  cliente asociado para dar de alta/editar un usuario tipo Cliente (Edge
  Function y frontend validan esto, además de la constraint `check` de
  la columna).

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
| 2026-11-19 | **Incidente en producción**: la auditoría de arquitectura (ver fila de abajo) borró `envios_historial` asumiendo que estaba muerta (confirmado por grep sobre el código, nunca sobre triggers de Postgres) — rompió `publicar_supabase.py` en todas las corridas ("relation envios_historial does not exist") porque un trigger real en `envios` escribía ahí. Fix: migración `2026-11-19b_fix_trigger_envios_historial.sql` (borra el trigger y la función, no resucita la tabla — confirmado que nada la leía). Verificado exhaustivo después del fix: `select * from information_schema.triggers where trigger_schema='public'` solo muestra las 2 de `updated_at` ya existentes (`asistencia_diaria`, `choferes_roster`) + la nueva de `fallidos_seguimiento`; ninguna función en `pg_proc` menciona `envios_historial`/`estado_chofer`/`alertado`. Lección agregada arriba (sección 2, antes de borrar cualquier cosa). |
| 2026-11-19 | **Auditoría completa de arquitectura de base de datos** (migración `2026-11-19_auditoria_arquitectura.sql`): (1) borrado un índice duplicado sobre `envios.fecha_mercadopacks` (bug propio del 18/11); (2) borradas `asistencia_diaria.estado_chofer`/`alertado` y la tabla `envios_historial` completa — nada en el código los usaba; (3) agregada FK `asistencia_diaria.lightdata_id` → `lightdata_usuarios.lightdata_id` (ya existía en `choferes_roster`, faltaba acá); (4) `fallidos_seguimiento` ahora tiene `updated_at`/`actualizado_por` (trigger automático, no depende del frontend) para poder auditar quién tocó un caso; (5) **RLS por vista real**: hasta ahora cualquier usuario logueado podía escribir en cualquier tabla vía API aunque `vistas_permitidas` no le diera esa vista — el permiso por vista era 100% cosmético (solo ocultaba el menú). La función `tiene_permiso_vista(vista)` replica exacto el criterio de `puedeVerVista()` del frontend (admin ve todo, sin perfil = fail-open) y ahora las policies de escritura de `parametros_*`/`choferes_roster` (vista `admin`), `fallidos_seguimiento` (vista `fallidos`) y `asistencia_diaria` (vista `repa-asistencia`) la usan de verdad; lectura se deja abierta a cualquier autenticado donde hacía falta para combos/dropdowns de otras pantallas; (6) revocados los privilegios por defecto de `anon` en todas las tablas (nunca se usa, login 100% Supabase Auth). Backfill de `chofer_lightdata_id` corrido sobre los ~22.600 envíos previos a la vinculación por ID: 19.578 resueltos por nombre normalizado (82,9%), el resto queda con homónimos ambiguos o sin cadete asignado (no se adivina). **Bug encontrado al hacer el backfill**: un upsert parcial de supabase-py (solo `id_interno` + `chofer_lightdata_id`, sin el resto de columnas NOT NULL) le erraba siempre al `ON CONFLICT` e intentaba insertar una fila incompleta — se reemplazó por la función `actualizar_chofer_lightdata_id_lote(ids, valores)` (UPDATE real vía `unnest`, un solo viaje por lote de 500), usada ahora tanto en `vincular_choferes_envios.py` como en `scripts/backfill_chofer_lightdata_id.py`. Decisión explícita: NO se relajó el `UNIQUE` de `choferes_roster.nombre` (es la causa de fondo de por qué `sincronizar_lightdata.py` tiene que tratar homónimos a mano) — queda como deuda técnica documentada, no se tocó por el riesgo de habilitar altas manuales duplicadas sin un beneficio inmediato claro. |
| 2026-11-19 | **Fix de falsos positivos en la detección de Cambio (parche inicial)**: `Logistica Inversa` es texto libre sin estandarizar (ver `diccionario_de_datos.md`) y puede traer literalmente `"No"`/`"NO"`/`"no"` (107 casos reales), que significa que NO hay logística inversa — con la regla `not.is.null` esos envíos entraban como Cambio por error. Se agregó `tieneLogisticaInversaReal()` (excluye vacío/"no"/"n/a"/"na") en `determinarTipoDestinoFallido()`, y la consulta de candidatos (`cargarFallidos()`, query D) ahora excluye esos valores también para no traerlos de entrada. **Superado por el fix de fondo de la fila siguiente.** |
| 2026-11-19 | **Fix de fondo de Logistica Inversa + rediseño completo de `envios` (sacar `raw`)**: el endpoint de envíos de Lightdata (`lightdata_api_envios.md`) tiene un flag confiable (`filtros.logisticaInversa` 0=No/1=Sí/2=Todos, verificado: 58003+953=58956) que NO se puede pedir como columna, solo como filtro — `vincular_choferes_envios.py` ahora hace una segunda consulta filtrada por 1=Sí y cruza los `did` para completar `envios.logistica_inversa_real` (booleano, fuente de verdad real; el parche de texto de la fila anterior queda solo como respaldo para envíos que ese script todavía no procesó). De paso se encontró que 25 de los 107 envíos con texto "no" en realidad SÍ tenían logística inversa real según Lightdata — el parche de texto solo los hubiera seguido perdiendo. — Se promovió además TODO lo que vivía dentro de `envios.raw` (jsonb) a columnas propias (`cp`, `origen`, `precio`, `provincia`, `cod_cliente`, `fecha_venta`, `id_venta_ml`, `zona_precio`, `quien_estado`, `razon_social`, `url_tracking`, `fecha_colecta`, `nombre_cuenta`, `usuario_ml_id`, `tipo_direccion`, `total_a_cobrar`, `metodo_envio`, `comentario_destino`) + 2 nuevas del endpoint JSON en vivo (`estado_ml`, `did_cliente`, de `estadoml`/`didCliente`) — y los 5 campos sensibles del destinatario (`Nombre Destinatario`, `Dirección`, `Tel.`, `Email`, `Latitud`/`Longitud`) se movieron a una tabla nueva `envios_contacto_destinatario`, con su **propia RLS cerrada** (sin policy para `authenticated` — RLS es por fila, no por columna, así que la única forma real de esconder datos sensibles de la misma fila es en otra tabla). `publicar_supabase.py` ya no escribe `raw` en absoluto. Migraciones en 2 pasos (aditivo primero, drop de `raw` después de confirmar el backfill con `scripts/backfill_columnas_raw.py` sobre las ~24.849 filas existentes). Los 2 RPC de lote del 18/19-11 (`actualizar_chofer_lightdata_id_lote`/`actualizar_logistica_inversa_lote`) se reemplazaron por uno solo (`actualizar_envio_lightdata_vivo_lote`, jsonb) que actualiza las 4 columnas del endpoint en vivo en un viaje por lote. **Resultado medido**: `envios` pasó de 46MB a 12MB después de `VACUUM FULL` (`DROP COLUMN` no libera espacio en disco solo — hace falta un VACUUM FULL aparte, y no se puede correr desde el SQL Editor de Supabase por la transacción implícita, hay que hacerlo por conexión directa). Bug encontrado en el backfill: la paginación de `backfill_columnas_raw.py` no tenía `.order()`, así que con el cron de producción escribiendo en paralelo se saltearon ~12.800 filas en la primera corrida — se agregó `.order("id_interno")` y un filtro de "todavía no migrado" para que sea seguro repetir. Campos perdidos a propósito al borrar `raw` (sin columna propia, <1% de las filas, ver changelog): `col_37` (parece un `Logistica Inversa` corrido de columna en algunos lotes viejos del Excel) y una clave vacía de parseo. |
| 2026-11-19 | **Fix: `index.html` (Dashboard de Envíos y modal de ruta) y la función RPC `resumen_envios()` quedaron usando `raw->>'Origen'`** tras el rediseño de la fila de arriba — rompía la carga de ambos con "Error cargando los datos.". Se cambió a la columna propia `origen` en los 2 lugares (`abrirDetalleRutaChofer` en el frontend, `resumen_envios()` en la base — migración `2026-11-19f_fix_resumen_envios_raw.sql`). Verificado con `select proname from pg_proc where prokind='f' and pg_get_functiondef(oid) ilike '%raw%'` que no queda ninguna otra función de `public` referenciando `raw`. |
| 2026-11-19 | **3 fixes en Fallidos y Cambios**: (1) `envios.estado = "A retirar"` nunca es un fallido/cambio (el paquete espera que el cliente lo retire, no hubo intento fallido) — se excluye en `cargarFallidos()` sin importar la configuración de `parametros_fallidos_mapeo`, salvo que ya tenga un caso abierto a mano. (2) **Bug de fondo de estado desactualizado**: `vincular_choferes_envios.py` ya pedía `estado_envio` (el estado real del envío, mismo vocabulario que la columna "Estado" del Excel — ver `lightdata_api_envios.md` §4.1) al endpoint en vivo de Lightdata cada 10 min, pero nunca lo guardaba — `envios.estado` solo se refrescaba con la publicación de Excel, así que un envío podía seguir figurando "No Entregado" en Fallidos horas después de que Lightdata ya lo marcara "Entregado"/"Devuelto al cliente" (caso real: tracking 48514057705). Se agrega `estado` al RPC `actualizar_envio_lightdata_vivo_lote` (migración `2026-11-19g_estado_vivo_envios.sql`), así que ahora se refresca cada 10 min igual que `chofer_lightdata_id`/`logistica_inversa_real`/`estado_ml`/`did_cliente`. (3) **Nombres de repartidores estandarizados solo para mostrar** (Lightdata trae una mezcla de MAYÚSCULAS/minúsculas/Mixto): `tituloNombre()` en el frontend (Title Case) se aplica en cada lugar donde se renderiza un nombre de repartidor (Fallidos, Asistencia, Seguimiento en Ruta, ABM de Repartidores) — nunca en el `data-chofer`/claves de matching, que siguen con el valor crudo para no romper ningún cruce. |
| 2026-11-19 | **Fix del fix anterior**: `estado_envio` del endpoint en vivo de Lightdata viene como CÓDIGO NUMÉRICO (0-31, tabla en `lightdata_api_envios.md` §4.1), no como texto — el punto (2) de la fila de arriba guardaba el número crudo en `envios.estado` (ej. "7" en vez de "A retirar"), pisando el texto correcto y rompiendo de paso la exclusión de "A retirar" del punto (1), porque esa comparación es contra el string exacto. Se agrega `CODIGOS_ESTADO`/`texto_estado()` en `vincular_choferes_envios.py` que traduce el código al mismo texto que usa el resto del sistema (usando la grafía exacta de `parametros_fallidos_mapeo` donde coincide, ej. "Nadie 2da visita" en minúscula, "Entregado 2DA visita" en mayúscula — así están los datos reales, no es inconsistencia de tipeo). No hizo falta backfill manual: el script solo toca los envíos del día en curso, así que el próximo ciclo de 10 min corrige solo los que se habían corrompido con el código crudo. |
| 2026-11-19 | **Tercer bug de la misma cadena: el refresco en vivo solo cubría el día de HOY.** Verificado el código 8 ("Cancelado") contra una consulta puntual real a Lightdata (tracking 48553756312) — coincidía con `CODIGOS_ESTADO`, así que el mapeo de códigos estaba bien. El problema real: ese tracking tenía 2 días de antigüedad, y `vincular_choferes_envios.py` solo pedía `fecha_desde = fecha_hasta = hoy`, así que nunca se volvía a refrescar una vez pasada la medianoche — quedaba congelado en lo último que dijo el Excel. Fix: `obtener_envios_del_dia` → `obtener_envios_del_rango`, `main()` ahora pide `fecha_hasta - RANGO_DIAS_LIVE días` hasta hoy (`FECHA_DESCARGA` sigue pidiendo un solo día puntual para uso manual). **El valor de `RANGO_DIAS_LIVE` se midió en vivo, no se adivinó**: dry-run real contra Lightdata con 3/5/7 días — 3 días anduvo bien (~23s, 7.388 filas), 5 y 7 días quedaron colgados más de 8 minutos sin responder ni tirar error, incluso subiendo el timeout del request de 20s a 60s (de paso se encontró y arregló que `page.set_default_timeout` no aplica a `page.request.*`, tiene su propio timeout de 30s por defecto — bug real aparte). El endpoint de Lightdata se degrada de forma no lineal pasado cierto rango, así que **el default queda en 3 días** (cubre el umbral "pedir" completo, no "revisar" — ver `qa_fallidos_estado.md`, sección "Alcance no cubierto", para por qué y la alternativa si hace falta cubrir ese hueco a futuro: apuntar por tracking puntual en vez de barrer por fecha). De paso se arregló un bug de `con_reintentos()` (`sincronizar_lightdata.py`) que, en Windows, moría con `UnicodeEncodeError` al loguear un mensaje de error con caracteres no-cp1252 (ej. "→" de Playwright) — mataba el reintento entero en vez de reintentar (no afecta al runner de GitHub Actions, que es Ubuntu/UTF-8, pero sí al debug local). Se agrega además `scripts/qa_validar_estado_vivo.py` (test de regresión de solo lectura: compara Lightdata en vivo contra `envios.estado` para toda la muestra del rango) y `qa_fallidos_estado.md` (batería de test manual + automatizado documentada, a correr después de cualquier cambio a este pipeline). |
| 2026-11-19 | **El fix de arriba no se estaba activando en producción**: `publicar_supabase.yml` forzaba SIEMPRE `FECHA_DESCARGA` a hoy antes de llamar a `vincular_choferes_envios.py` — con esa variable seteada, el script ignora `RANGO_DIAS_LIVE` y vuelve al modo de un solo día de siempre (lo confirma el run #91 de las Actions: 1m40s, consistente con un solo día, no con un rango de 3). El tracking 48553756312 seguía sin refrescarse después del fix. Se corrige el workflow para que solo fije `FECHA_DESCARGA` cuando `workflow_dispatch` trae un input manual puntual — en la corrida normal del cron queda sin setear y el script usa su rango por defecto. |
| 2026-11-19 | **Backfill único de los casos viejos de Fallidos y Cambios** (`scripts/backfill_estado_fallidos_viejos.py`, no es parte del cron): arma la lista de candidatos desde la propia base (mismo criterio que `cargarFallidos()`, sin importar antigüedad) y le pregunta a Lightdata por cada `tracking_number` puntual, en vez de barrear por fecha. Corrido por el usuario: 387 envíos actualizados, 0 no encontrados — de los ~241 que tenían un estado "fallido" guardado, quedaron 136 con estado real pendiente después del backfill (el resto ya estaba resuelto en Lightdata, solo desactualizado acá). |
| 2026-11-19 | **Configuración → Usuarios: "Vistas permitidas" pasa a un modal de detalle** (mismo formato que el ABM de Repartidores) en vez de una columna ancha en la tabla — se agrega el ícono de ojo en Opciones (`abrirDetalleUsuario()`, reusa `.grid-detalle-compacto`/`.campo-detalle` ya existentes, sin CSS nuevo). |
| 2026-11-19 | **"Por repartidor" mostraba varios "Sin Repartidor" como si fueran repartidores distintos**: `envios.chofer_lightdata_id` se completa en vivo por ID, pero `envios.cadete` (texto del Excel) puede quedar vacío para esos mismos envíos — se agrupaban bien por ID (clave `ld:<id>`, correcto) pero el nombre para MOSTRAR caía siempre a "Sin repartidor" porque solo miraba `cadete`, así que varios repartidores reales y distintos se veían como filas idénticas repetidas. Se agrega `cargarNombresPorLightdataId()` (carga `choferes_roster.nombre` por `lightdata_id`) y `nombreRepartidorFallido(envio)`, que resuelve el nombre real por ID cuando `cadete` viene vacío, usado en "Por repartidor" y en la columna Repartidor de "Por Envíos". |
| 2026-11-19 | **4 pedidos sobre Fallidos y Cambios**: (1) **Cierre masivo**: checkbox por fila + "Seleccionar todos" en el detalle de un repartidor y en "Por Envíos", con botón "Cerrar seleccionados" que abre el mismo formulario de siempre (estatus/motivo/observaciones/precio a descontar) y lo aplica a todos los casos tildados en un solo guardado (`cerrarCasosSeleccionados()`). (2) **Columna Dirección**: vive en `envios_contacto_destinatario` (separada a propósito en el rediseño de `envios`, sin policy para `authenticated`) — se agrega una policy de SOLO LECTURA acotada a usuarios con la vista "fallidos" (migración `2026-11-19h_lectura_direccion_fallidos.sql`, reusa `tiene_permiso_vista()`), y se trae como embed por FK (`envios_contacto_destinatario(direccion)`) en vez de abrir la tabla entera. (3) **Regla 15 de sección 1**: estandarización de texto libre de la base a Title Case (`tituloTexto()`, `tituloNombre()` ahora es un alias) aplicada en Fallidos a cliente/localidad/origen/estado — documentada como regla de sistema para todo texto nuevo. (4) **Causa real de los repartidores "duplicados"** (ej. Nahuel Gonzalez, Cristian Casenave): dos bugs distintos, no uno — (a) envíos viejos con `chofer_lightdata_id` null que no tenían cómo agruparse con los que sí lo tienen (`claveRepartidorEnvio` ahora intenta resolver el ID por nombre normalizado contra el roster antes de caer al nombre crudo como clave); (b) un envío con `cadete="Nahuel Gonzalez"` tenía en realidad `chofer_lightdata_id=198`, que es **Ian Velez** — el texto había quedado desactualizado tras una reasignación en Lightdata. `nombreRepartidorFallido()` ahora prioriza el nombre resuelto por ID sobre el texto de `cadete` (mismo criterio ya establecido de "ID de Lightdata manda sobre el nombre", ver changelog 2026-11-18), así que esos casos se muestran con su nombre real en vez de duplicar visualmente al repartidor equivocado. Nota aparte: el roster tiene a "Nahuel Gonzales" (con S) mientras Lightdata trae "Gonzalez" (con Z) para `lightdata_id=1276` — no es un problema que el código pueda resolver solo, es un dato mal cargado a corregir a mano en el ABM de Repartidores si se quiere que el nombre coincida. |
| 2026-11-19 | **Falta un estado en `parametros_fallidos_mapeo`**: "Reprogramado por comprador" (código 30, ver `lightdata_api_envios.md` §4.1) nunca se agregó a la tabla de mapeo — cualquier envío con ese estado exacto no entraba a Fallidos y Cambios aunque sí fuera un fallido real (caso real: tracking 48567349512, 14 envíos afectados el mismo día). Agregado vía insert directo (`estado='Reprogramado por comprador', tipo='Fallido', destino='Vuelve a salir'`, mismo criterio que "Reprogramado por meli"/"En camino reprogramado") — es dato de configuración, no un cambio de código, así que no hay migración ni commit para esto. Queda como recordatorio: si aparece un estado nuevo de Lightdata que debería ser Fallido/Cambio y no lo es, el primer lugar a revisar es esta tabla (Configuración → Fallidos, o `parametros_fallidos_mapeo` directo), no asumir que es un bug de código. |
| 2026-11-20 | **"Devuelto al cliente" seguía apareciendo en Fallidos y Cambios** (ya gestionado, no debería contar) — se excluye en `cargarFallidos()` junto con "A retirar" (`ESTADOS_SIEMPRE_EXCLUIDOS`), salvo caso abierto a mano. |
| 2026-11-20 | **2 bugs reales en `backfill_estado_fallidos_viejos.py` (reconciliación de Fallidos/Cambios viejos), encontrados investigando un caso puntual** (tracking "2960", FLIA HDC GROUP S.R.L., `logistica_inversa_real=true` desde el 17/11 sin refrescarse — confirma que el bug de fondo de esa columna, igual que el de `estado` del 19/11, es que nunca se re-chequea pasados los `RANGO_DIAS_LIVE` días): (1) el filtro `tracking_number` de Lightdata matchea por SUBSTRING, no exacto — pedir "2960" devolvía como primera fila un envío de ML ajeno cuyo tracking largo ("48582960190") simplemente lo contenía; (2) un mismo tracking corto puede pertenecer a DOS envíos reales distintos en Lightdata (mismo texto, `did` distinto) — exigir coincidencia exacta de tracking no alcanza, hay que desambiguar por `did == id_interno`. Se agrega `_fila_exacta()` (antes tomaba `filas[0]` a ciegas) con las dos verificaciones; si no se puede resolver sin ambigüedad, se trata como "no encontrado" en vez de arriesgar una actualización cruzada. Se re-corrió el backfill completo con el fix (417 candidatos, 406 actualizados, 11 no encontrados genuinos) para pisar las actualizaciones incorrectas de las 2 corridas previas al fix. Nota aparte, sin resolver: para ese mismo tracking 2960, el filtro `logisticaInversa=1` de Lightdata sigue devolviendo `true` aunque el campo de texto libre "Logística Inversa" en el detalle del envío (la fuente que mira el usuario) dice "no" — decisión explícita: no se cambia la lógica de clasificación por ahora, el equipo revisa a mano los casos que le resulten raros. |
| 2026-11-20 | **`backfill_estado_fallidos_viejos.py` pasa a ser parte del cron** (antes "corrida única"): se agrega `.github/workflows/backfill_fallidos_diario.yml` (1 vez por día, 08:00 UTC = 05:00 ART, antes del horario operativo) para que ningún caso de Fallidos/Cambios quede desactualizado para siempre por salir de la ventana de `RANGO_DIAS_LIVE`. |
| 2026-11-20 | **Reorganización de carpetas** (el repo tenía todo mezclado en `scripts/` y los `.md` de negocio sueltos en la raíz): los docs de negocio/arquitectura se mueven a `docs/` (`reglas_de_negocio.md` — este archivo —, `diccionario_de_datos.md`, `integracion_usuarios_lightdata.md`, `lightdata_api_envios.md`, `qa_fallidos_estado.md`); `scripts/` se separa por función en `ingesta_lightdata/` (el pipeline de cada 10 min, se importan entre sí — quedan juntos a propósito), `fallidos_y_cambios/` (el backfill diario), `qa/` (test de regresión) y `migraciones_python_unicas/` (backfills de una sola vez ya ejecutados, archivo histórico); `scripts/migraciones/` (SQL) sin cambios. Se agrega `.claude/skills/` con 2 skills propios de este repo (`mercadopacks-sistema-ui-rules`, que apunta a la sección 1 de este archivo; `levantar-entorno`, cómo servir `index.html` local y correr los scripts). Se actualizaron los `import`/`sys.path.insert` entre scripts movidos a carpetas distintas y los dos workflows de GitHub Actions (`working-directory`, ruta de `error_descarga.png`) — verificado que cada script resuelve sus imports y su `.env` desde la nueva ubicación antes de dar el cambio por terminado. Ver `README.md` para el árbol completo. |
| 2026-11-20 | **Acceso por cliente + `tipo_usuario`** (pedido del usuario): el ABM de Usuarios distingue "Administrativo" (personal de la empresa, ve todo) de "Cliente" (acotado a sus propios envíos). Reemplaza el `sector` de texto libre por `tipo_usuario` + `sector_id` (FK a la nueva tabla `parametros_sectores`, con su propio ABM en Configuración → Sectores) + `clientes_lightdata_ids bigint[]` (para tipo Cliente). Se agrega `lightdata_clientes` (sincronizada 1 vez por día por `scripts/ingesta_lightdata/sincronizar_clientes_lightdata.py`, endpoint `getClientes` — ver `lightdata_api_clientes.md`) para que el ABM busque clientes por nombre en un combo, no por ID a mano. El acceso real se aplica con policies RESTRICTIVAS (`as restrictive`) sobre `envios`/`envios_contacto_destinatario`/`fallidos_seguimiento` vía `puede_ver_envio_de_cliente(did_cliente)` (migración `2026-11-20_tipo_usuario_y_acceso_por_cliente.sql`) — ver sección 2 para por qué tiene que ser restrictiva y no una policy permisiva más. La Edge Function `crear-usuario` y el frontend validan que un usuario tipo Cliente tenga al menos un cliente asociado antes de guardar. No se tocó qué vistas ve un usuario Cliente (`vistas_permitidas` sigue siendo independiente) — queda para una tarea aparte decidir qué pantallas tiene sentido que vea un portal de cliente. |
| 2026-11-20 | **Nueva sección "Envíos" (listado), distinta del "Dashboard de Envíos"** (que es agregados/gráficos, vista clave `envios`) — vista clave `envios-listado`, pedida para probar en la práctica el acceso por cliente de la fila de arriba (el primer test con un usuario de prueba mostraba todos los envíos porque ese usuario había quedado con `tipo_usuario='administrativo'`, no porque faltara el filtro — la RLS restrictiva ya funcionaba). Listado paginado (`range()`, 100 por página, botón "Cargar más") con buscador (tracking/cliente/localidad, con debounce porque busca contra la base, no en memoria — a diferencia de Fallidos, que filtra un array ya cargado), filtro de fecha desde/hasta (default: últimos 30 días sobre `fecha_mercadopacks`) y filtro por Estado/Origen (mismo patrón de combo que Fallidos). Botón Detalle por fila abre un modal con todos los campos del envío — sin la dirección del destinatario (`envios_contacto_destinatario`), porque esa tabla solo tiene policy de lectura para la vista `fallidos` (migración `2026-11-19h`); si se quiere mostrar acá también, hace falta extender esa policy para la vista `envios-listado`. No necesita lógica de filtrado por cliente en el frontend — la RLS restrictiva de `envios` ya devuelve solo lo permitido para quien está logueado, sea cual sea la pantalla que pregunte. |
| 2026-11-20 | **5 ajustes sobre "Envíos" y el acceso por cliente, tras la primera prueba real**: (1) el panel de filtros no abría — faltaba el `crearPopoverGenerico("popover-filtros-envios-listado")` (cada popover de filtros se registra a mano, no es automático por tener la clase `combo-filtro`). (2) Se agrega `id_venta_ml` a la grilla y al detalle. (3) Reemplazado el "Cargar más" (acumulaba filas) por paginación real: `select(..., {count:"exact"})` + `range()`, selector de tamaño de página (10/20/50/100, combo propio — no `<select>` nativo, Regla de sección 1) y texto "Mostrando X–Y de Z envíos". (4) **Bug real de fondo, no de esta pantalla**: al cerrar sesión y entrar con otro usuario en la misma pestaña, se veían por un instante los datos del usuario anterior — decenas de variables de estado en memoria (`stateFallidos`, `adminUsuariosData`, `stateEnviosListado`, etc.) nunca se limpiaban al desloguear. Se cambia `logoutBtn` para hacer `window.location.reload()` en vez de solo `mostrarLogin()` — la única forma de garantizar que no quede nada de la sesión anterior en memoria sin tener que acordarse de resetear cada variable de estado a mano. (5) El primer test de acceso por cliente mostraba todos los envíos no por un bug de la RLS sino porque el usuario de prueba había quedado con `tipo_usuario='administrativo'` (nunca se configuró como Cliente) — la RLS restrictiva ya andaba bien. |
| 2026-11-20 | **Módulo "Clientes" en Configuración** (mismo criterio que Repartidores, pero de solo lectura — los datos vienen sincronizados de Lightdata, no se cargan a mano): se agrega `lightdata_cuentas` (migración `2026-11-20b_lightdata_cuentas.sql`, FK a `lightdata_clientes.did`, sin columnas de credenciales — ver `lightdata_api_clientes.md` §3) y se extiende `sincronizar_clientes_lightdata.py` para además pedir `getCliente` por cada cliente (secuencial, ~1.5-2.5 min para ~297 clientes, se agregó al mismo cron diario) y guardar sus cuentas con al menos un ID externo (ML/Tienda Nube/Shopify/WooCommerce/VTEX/PrestaShop/Falabella). La pantalla lista clientes (código, nombre, razón social, habilitado, cantidad de cuentas) con buscador, y un "Ver detalle" muestra la tabla de cuentas asociadas por integración. |
| 2026-11-20 | **2 ajustes más sobre "Envíos"**: (1) se agrega filtro por Cliente (combo con buscador automático — `crearComboGenerico` ya agrega un buscador solo cuando hay más de `UMBRAL_BUSCADOR_COMBO` opciones, acá ~300), y de paso Localidad/Zona/Repartidor (interpretación práctica de "filtrar por todos los datos que contenga la tabla" — se cubrieron las dimensiones categóricas con sentido como filtro de combo; campos de texto libre/numéricos como precio u observaciones quedan para el buscador de texto o un pedido aparte si hace falta). Estos 4 combos se arman por JS la primera vez que se entra a la pantalla (`inicializarFiltrosEnviosListado()`) porque sus opciones vienen de la base (no se pueden hardcodear como Estado/Origen); Localidad/Zona se filtran con `ilike` en vez de `eq` porque son texto libre de Lightdata con mayúsculas/minúsculas mezcladas (Regla 15), comparar exacto contra el valor prolijo de `parametros_localidades`/`parametros_zonas` fallaría en silencio. Repartidor filtra por `chofer_lightdata_id` (cruce por ID, no por nombre, mismo criterio de siempre). (2) La grilla mostraba "Fecha" sin aclarar cuál — se renombra a "Fecha Mercadopacks" (que es la que ya mostraba) y el detalle ahora trae las 6 fechas de `envios` (Mercadopacks, venta, estado, asignación, a planta, colecta). |
| 2026-11-20 | **Precios por Cliente** (primer paso de la liquidación de clientes/repartidores, pedido del usuario junto con una planilla de referencia `logica_informacion_base_clientes.md`): se agregan 3 ABMs nuevos en Configuración — **Tamaños de paquete** (`parametros_tamanos_paquete`, seed Pequeño/Mediano/Grande) y **Cordones** (`parametros_cordones`, seed CABA/GBA1/GBA2/GBA3), ambos ABMs simples (`crearAbmSimple`, ahora con `obtenerActivosConId()` además de `obtenerActivos()` para poder usarlos como `select` por FK). (2) **Unificación Zona + Localidad + CP + Cordón**: hasta ahora `parametros_zonas` y `parametros_localidades` eran dos ABMs sin ningún vínculo entre sí — se agregan las columnas `zona`/`cp`/`cordon_id` (FK a `parametros_cordones`) directo a `parametros_localidades` (migración `2026-11-20c_precios_por_cliente.sql`) y la pantalla "Localidades" pasa a mostrar las 4 columnas; `parametros_zonas` queda deprecada (no se borra, no tiene ABM propio) y el filtro de Zona de "Envíos" ahora saca sus opciones de `abmLocalidades.obtenerZonasActivas()` (distinct de la columna `zona`) en vez de la tabla vieja. (3) **Tarifario por cliente** (Configuración → Precios por Cliente): cabecera `precios_cliente` (1 fila por cliente — `tipo_servicio` "Última milla" o "Fulfillment"; si es Fulfillment, además `precio_deposito_pallet` y `precio_despacho_envio`, que son el **precio unitario** — la cantidad de pallets/envíos de cada liquidación se calcula después, no acá) + dos matrices hijas: `precios_cliente_envio` (precio por tamaño × cordón) y `precios_cliente_flete` (precio por cordón). El modal de edición arma la matriz dinámicamente según los tamaños/cordones activos (no son columnas fijas, por eso no se pudo modelar como 4 columnas tipo la planilla vieja) y al guardar borra e inserta de nuevo las filas de ambas matrices (más simple y sin riesgo de filas huérfanas que un diff celda por celda). RLS: lectura y escritura de precios solo con la vista "admin" (`precios_cliente*` con policies `for all`, igual que el resto de Configuración) — a diferencia de `parametros_tamanos_paquete`/`parametros_cordones` (lectura abierta a cualquier autenticado, los necesitan otros combos), el tarifario es información comercial y ningún usuario tipo Cliente debe poder verlo. Probado de punta a punta con jsdom simulando Supabase (ABMs, armado de matriz, guardado y las 3 tablas resultantes). Pendiente (no pedido todavía): tarifas Turbo/Colecta de la planilla vieja, y el cálculo real de la liquidación que consume estos precios. |
| 2026-11-21 | **Grants faltantes en la migración de Precios por Cliente** (bug real recién detectado, ya corregido): `2026-11-20c_precios_por_cliente.sql` creó `parametros_tamanos_paquete`/`parametros_cordones`/`precios_cliente*` con RLS completa pero sin los `grant` de Postgres a `authenticated`/`service_role` — en Supabase, sin el `grant` la policy de RLS ni se evalúa, Postgres rechaza el acceso un paso antes (`permission denied for table`, código `42501`). Mismo patrón que ya se había hecho bien en `2026-11-20_tipo_usuario_y_acceso_por_cliente.sql`/`2026-11-20b_lightdata_cuentas.sql`, pero se olvidó en esta. Corregido con `2026-11-21b_grants_precios_por_cliente.sql`. También se aplicó `2026-11-21_separar_zonas_de_localidades.sql` (ver fila siguiente) y se forzó `NOTIFY pgrst, 'reload schema'` — ahora `aplicar_migracion.py` lo hace solo al final de cada migración, porque el caché de esquema de PostgREST no se refresca solo al instante (mismo síntoma ya visto con `lightdata_cuentas` el 20/11, esta vez además agravado por el bug de grants). Se documenta como regla permanente en memoria del asistente (no solo en este repo) por ser la segunda vez que pasa. |
| 2026-11-21 | **Revertido el pedido de unificación Zona+Localidad del 20/11, a pedido explícito del usuario**: Zona vuelve a ser su propio ABM parametrizable (`parametros_zonas`, nunca se había borrado), y `parametros_localidades` se asocia a ella por `zona_id` (FK) en vez del `zona` de texto libre agregado el 20/11 — ese texto libre se borra (`2026-11-21_separar_zonas_de_localidades.sql`, sin pérdida de datos: nadie había llegado a cargar zona/cp/cordón todavía). CP y Cordón de la localidad quedan igual que antes. Se revierten también los 3 lugares que habían pasado a usar `abmLocalidades.obtenerZonasActivas()` (Zona de Asistencia×2, filtro de Zona de "Envíos") — vuelven a `abmZonas.obtenerActivos()`. |
| 2026-11-21 | **"Precios por Cliente" se mueve adentro del módulo de Clientes** (a pedido del usuario: el precio se asocia 1 a 1 a cada cliente, no tiene sentido una sección aparte) — se borra la pantalla/nav separada, y la grilla de Clientes agrega un botón ($) por fila (`abrirPreciosCliente()`, mismo modal de siempre) y una columna "Tipo de Servicio" que muestra si ya tiene tarifario configurado. |
| 2026-11-21 | **Bug real de CSS, global, no solo de "Localidades"**: el multiselect de un campo de modal (ej. "Localidades" del ABM de Repartidores) salía más angosto que el campo — `.panel-multiselect{width:100%}` y `.panel-filtros-ruta{width:220px}` tienen la MISMA especificidad (1 clase cada una), así que ganaba la que estuviera más abajo en el archivo CSS (`.panel-filtros-ruta`, por simple orden de aparición), sin importar la intención de ninguna de las dos reglas. Se cambia el selector a `.panel-filtros-ruta.panel-multiselect` (2 clases, gana sin depender del orden) — corrige TODOS los multiselect de la app de una sola vez, no solo Localidades. |
| 2026-11-21 | **Modal de detalle de Cliente con tamaño fijo** (antes crecía con la cantidad de cuentas vinculadas y podía salirse de la pantalla): `.modal-card` de ese modal queda con `max-height:80vh`, y la lista de cuentas asociadas scrollea adentro en un contenedor propio (`.tabla-cuentas-cliente-scroll`, `max-height:220px`) en vez de estirar todo el modal. |
| 2026-11-21 | **Títulos de columna centrados en la grilla de "Envíos"** (pedido puntual de esa pantalla, no un cambio global de estilo de tabla). |
| 2026-11-21 | **Regla 16 de sección 1 (nueva): "consultar solo lo que se necesita"**, a partir de un pedido de performance del usuario sobre el módulo de Configuración. Análisis real de tamaños antes de decidir qué hacer (conteo directo contra la base): las tablas de parámetros chicas (Vehículos 6, Zonas 5, Turnos 6, Cordones 4, Tamaños de paquete 3, Sectores 2, Localidades 47) son chicas de verdad — agregarles paginado real sería complejidad sin beneficio. Los dos casos que sí pesan son `choferes_roster` (858 filas, toda la plantilla histórica) y `lightdata_clientes`+`lightdata_cuentas` (296+496). Para esos dos, en vez de construir paginado server-side completo (que para Choferes exigiría rehacer los 5 filtros combinados + la búsqueda contra una tabla con join + el contador de "pendientes", con alto riesgo de romper algo ya probado, para un ahorro real chico — 858 filas planas no son un problema serio de bandwidth/render), se aplicaron 2 optimizaciones de bajo riesgo y alto impacto real: (1) **caching de sesión**: `crearAbmSimple()`/`crearAbmLocalidades()`/`cargarAdminChoferes()`/`cargarAdminClientes()` ahora piden sus datos una sola vez por sesión (flag `cargado`), no cada vez que se vuelve a entrar a esa pantalla — antes, visitar "Repartidores" dos veces volvía a pedir Vehículos+Localidades+Cordones+Zonas+858 choferes+lightdata_usuarios de cero las dos veces. (2) **Clientes: el dato pesado se difiere al detalle** — la grilla de 296 clientes antes traía las 496 filas completas de `lightdata_cuentas` (7 columnas de IDs externos) solo para mostrar un número; ahora pide apenas la columna `did_cliente` para contar, y las columnas completas de cuentas se piden recién al abrir "Ver detalle" de UN cliente. Mismo criterio para `select("*")` → columnas explícitas en `lightdata_clientes`/`precios_cliente`. |
| 2026-11-21 | **3 ajustes más tras la primera prueba visual de Clientes/Precios**: (1) el fix de tamaño fijo del modal de detalle de Cliente (fila anterior) quedó mal — angostaba el modal y generaba doble scroll; se revierte el ancho/alto forzado del modal entero, dejando SOLO la lista de cuentas con su propio tope de alto (`.tabla-cuentas-cliente-scroll`), que alcanza por sí solo (el resto del contenido del modal es chico y fijo). (2) Títulos de las 2 matrices del modal de Precios por cliente, centrados (no se habían aplicado la primera vez). (3) Los inputs de precio pasan de `type="number"` a `type="text"` con formato moneda argentino ($ 0.000,00) — un `<input type="number">` nativo no puede mostrar separador de miles ni el símbolo "$", el navegador lo rechaza como valor inválido. Se agregan `formatearMoneda()`/`parsearMoneda()` (siempre se guarda el número parseado en la base, nunca el string formateado) y se reformatea el campo al perder el foco (`focusout` delegado, no en cada tecla — saltaría el cursor). |
| 2026-11-23/24 | **Módulo "Liquidaciones" completo** (sidebar "Liquidaciones" → Liquidación Clientes / Liquidación Repartidores): motor de cálculo (`calcular_totales_liquidacion_cliente` — envíos por tamaño/cordón + Turbo a precio fijo por envío + Adicional/Descuento de Extras + Depósito/Despacho solo Fulfillment) sobre 2 tablas nuevas `liquidaciones_clientes`/`liquidacion_extras_clientes` (+ `liquidacion_extras_repartidores`, motor de Repartidores todavía no armado). Extras/Descuentos **separado en 2 pantallas** (Clientes y Repartidores no pueden entrar al mismo panel — permisos distintos), con catálogo compartido `parametros_tipos_extra` (Signo adicional/descuento elegido ANTES que Concepto, combo de Concepto deshabilitado hasta elegir Signo; campo Dirección solo visible para conceptos de tipo Flete vía `requiere_direccion`, no para "no pide envío" en general). Se agrega `clientes_colectas` (dirección/turno/días de colecta por cliente, Turno como desplegable del catálogo de turnos, Días como multiselect de 7 días) y `precio_turbo_envio` en `precios_cliente`. Migración de datos desde Excel ("1. Informacion Base - Clientes.xlsx" → precios, "1. Informacion Base Repartidores.xlsx" → colectas) con reconciliación de nombres en 2 pasadas (`difflib`, revisado a mano — ratio alto no es suficiente por sí solo, ej. "VAN STORE" vs "AVANT STORE" se descartó a propósito). **Liquidación Clientes rehecha como pantalla completa** (no modal): una sola fila de filtros (buscador + combo Servicio + combo Período, reconstruido entero en cada cambio de servicio para no acumular listeners — ver `repoblarComboPeriodoLiquidacion` — + popover Filtrar por Estado + acceso directo a Adelantos y Descuentos), grilla con Cliente/Cant. envíos/Monto a pagar (estimado vía `resumen_liquidacion_clientes`, 1 sola consulta para toda la grilla en vez de 1 RPC por fila)/Estado, iconos de Ver/Editar/Liquidar (Ver y Anular una vez generada, ya no se puede editar) — "Ver"/"Editar" abren `#vista-detalle-liquidacion-cliente` con el detalle itemizado día por día (`detalle_liquidacion_cliente`: Nro/Fecha/Tipo/Cuenta (ml_user vía `lightdata_cuentas`)/Dirección/Localidad/Cordón/Tamaño/Monto, estilo la liquidación de repartidor real que sirvió de referencia). |

---

## Changelog 2026-11-22 — Envíos (filtro/columnas/bugs) + nueva sección Picking Tamaños

1. **Envíos (listado):** el filtro de fecha por defecto pasa de 30 a 7 días
   (`fechaART(-6)`), para no cargar tantos datos de entrada.
2. **Envíos (listado):** columnas reordenadas a Fecha Mercadopacks, Origen,
   Tracking, ID de venta, Cliente, Localidad, Dirección, Zona, Tamaño,
   Estado (se saca "Repartidor" de la grilla principal — sigue disponible
   en el detalle). "Dirección" reusa `direccionDe()` ya existente de
   Fallidos (embed por FK a `envios_contacto_destinatario`).
3. **Fix real, 2 bugs distintos en el popover "Filtrar" de Envíos** (no es
   el mismo bug de ancho ya corregido antes):
   - `.panel-filtros-ruta{right:0}` anclaba el panel por la derecha,
     abriéndolo hacia la izquierda del botón. Se agregó el modificador
     opt-in `.panel-filtros-ruta.abre-derecha{left:0; right:auto;}`,
     aplicado solo al popover de Envíos — los demás popovers "Filtrar" del
     sistema siguen anclados a la derecha (eran correctos así).
   - `.combo-filtro-lista` no tenía `max-width` (solo `min-width:100%`) y
     usa `white-space:nowrap` — una opción larga (ej. nombre de cliente)
     estiraba la lista más ancha que el panel de 220px que la contiene. Se
     acotó con `.panel-filtros-ruta .combo-filtro-lista{max-width:100%;
     white-space:normal;}`, scopeado solo dentro de `.panel-filtros-ruta`
     para no angostar combos sueltos de otras pantallas.
4. **Nueva sección "Picking Tamaños"** (sidebar, ítem propio, no dentro de
   Configuración): puerto de la planilla vieja (Picking.txt/Codigo.txt) a
   Supabase. Pantalla de escaneo con foco pegajoso (input autofocus, se
   re-enfoca solo mientras la vista está activa), parseo de prefijo
   `GRA-`/`MED-` → Grande/Mediano ("Pequeño" nunca se escanea, es el
   default implícito) y la misma regex anti-falsos-positivos de
   `did`/`tracking_number`/`id` que la planilla.
   - Tabla nueva `picking_tamanos` (migración
     `2026-11-22_picking_tamanos.sql`, con grants explícitos desde el
     vamos — ver regla de grants). Sin vaciado nocturno: todo el historial
     vive en la misma tabla (a diferencia de la planilla, acá no hay
     límite práctico de filas).
   - Unique index parcial en `id_normalizado` (excluye `'Revisar_Manual'`,
     que se repite legítimamente) para poder hacer upsert: reescanear el
     mismo paquete con otro tamaño pisa el escaneo anterior.
   - Cruce automático e inmediato con Envíos: al guardar cada escaneo se
     hace `update` de `envios.tamano` por `id_interno` o `tracking`
     (columna nueva, default `'Pequeño'`) — no hay botón manual de
     "actualizar cruces" como en la planilla vieja, el escaneo es la
     fuente de verdad y el último escaneo real siempre gana.

---

## Changelog 2026-11-23 — Picking Tamaños (rediseño), Mapeo Localidad→Cordón, fecha con hora

1. **Picking Tamaños rediseñado**: pasó de ser una sola pantalla de escaneo
   a tener el mismo estilo que el resto del sistema — buscador + filtro de
   fecha (por defecto "hoy", se resetea cada vez que se entra a la
   pantalla) + botón "Escanear" que abre un modal. El modal es un log de
   actividad puro (cada escaneo agrega su propia línea, "NUEVO"/"🔄
   CORREGIDO", nunca se dedupea ni se reemplaza — igual que `Lector.html`
   de la planilla vieja), acotado a ~6 filas visibles con scroll propio
   para que no se agrande de más. La grilla de atrás sí persiste y se
   refresca al cerrar el modal o al escanear si el filtro está en "hoy".
   - Bug real: el primer `upsert({onConflict})` fallaba siempre porque el
     unique index de `id_normalizado` es parcial (excluye
     `'Revisar_Manual'`) y Postgres no puede resolver `ON CONFLICT
     (columna)` contra un índice parcial sin repetir la condición ahí
     mismo — se resolvió con un select-then-update/insert manual en vez de
     depender de `upsert`.
   - `scripts/importar_picking_historico.py`: importa el histórico real
     (`Picking_Historica.xlsx`) solo del mes pedido, deduplicado por
     `id_normalizado` quedándose con el escaneo más reciente.
2. **`fecha_mercadopacks` pasó de `date` a `timestamptz`**: Lightdata
   manda hora real para ese campo, pero `publicar_supabase.py` la
   truncaba a propósito (`[:10]`). Esto obligó a reescribir 2 funciones
   SQL que comparaban por igualdad/`between` exacto de fecha
   (`choferes_en_ruta`, `resumen_envios`) para comparar por RANGO de día
   en huso horario ART explícito — si no, romperían la pantalla de
   Seguimiento en Ruta y el Dashboard de Envíos enteros. `diasDesde()` y
   `formatearFechaHora()` también se ajustaron para convertir
   correctamente un timestamp UTC a su "día ART" (un envío de las 23:50
   ART cae en el día siguiente en UTC).
3. **Mapeo Localidad+CP → Cordón** (puerto de la hoja `Base_Zonas`):
   `envios.zona` es el dato crudo de Lightdata y no es confiable del todo
   (ej. "Buenos Aires" en Lightdata es una sola zona, pero según el CP real
   puede ser CABA, GBA1 o GBA2). Se agregó `envios.cordon_id` (resuelto
   por Localidad+CP contra una tabla nueva `parametros_localidad_cps`,
   hija de `parametros_localidades` porque una misma localidad puede caer
   en más de un Cordón según el CP — confirmado con datos reales, 8
   localidades de `Base_Zonas` así lo hacían). `envios.zona` queda intacto
   como referencia, nunca se pisa.
   - Cruce bidireccional por triggers (mismo patrón que Tamaño): un envío
     nuevo busca su cordón solo (cascada CP+Localidad → CP → Localidad,
     igual a `actualizarCruces()` de la planilla vieja, incluida la
     limpieza de CP tipo `limpiarCP()` vía `normalizar_cp_localidad()`); si
     no matchea, se encola automáticamente como pendiente. Clasificar un
     CP a mano re-aplica el cordón a los envíos existentes.
   - Bug real de grants: los triggers son `SECURITY INVOKER` — cuando los
     dispara un usuario autenticado (no el pipeline de ingesta), el
     `UPDATE` interno sobre `envios` corre con SUS permisos, y
     `authenticated` nunca tuvo grant de escritura ahí (solo lectura,
     separar del pipeline fue intencional). Se agregó
     `grant update (tamano, cordon_id) on envios to authenticated` —
     acotado a esas 2 columnas, el resto del envío sigue de solo lectura
     para la app. Este mismo bug afectaba al cruce de Tamaño desde el
     principio, pero quedaba oculto porque el código viejo hacía ese
     `UPDATE` aparte (no atómico con el insert) y solo lo logueaba a
     consola sin avisar en pantalla.
   - Pantalla de Localidades rediseñada: ahora es una lista plana (sin
     agrupar/expandir) de Localidad+CP+Cordón, con badge "Sin clasificar"
     para los pendientes, filtro "Ver solo pendientes", y un botón
     "Resincronizar envíos" (`resincronizar_cordones_envios()`, función
     `SECURITY DEFINER` para no tener que ampliar más el grant de
     `envios`) para re-aplicar el cruce a mano si el trigger llegara a
     fallar para algún envío puntual.
   - Filtro de Envíos: "Zona" se renombra a "Cordón" y se reconecta — el
     combo estaba mal cableado desde siempre (comparaba `ilike` contra
     `envios.zona` usando las opciones de `abmZonas`, la asignación
     geográfica de repartidores — dos vocabularios que nunca podían
     matchear). Incluye la opción "Sin clasificar" para encontrar los
     pendientes directo desde Envíos.
4. **Alerta de "Configuración" en el sidebar**: 2 badges numéricos sueltos
   (choferes pendientes + localidades pendientes) se reemplazaron por un
   solo punto de alerta — avisa que hay algo pendiente sin decir cuánto
   (el número exacto sigue viéndose adentro de cada sub-sección). Bug
   real: la primera versión usaba un ícono Lucide (`<i data-lucide>`) con
   un `id` fijo — `lucide.createIcons()` reemplaza ese `<i>` por un `<svg>`
   nuevo que no conserva el `id`, así que la segunda vez que el código
   buscaba el elemento por ese id no lo encontraba y fallaba en silencio.
   Se cambió a un `<span>` simple (nunca tocado por Lucide), mismo
   criterio que ya usan el resto de los `nav-contador` del sistema.
