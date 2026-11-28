# Puente temporal: Picking Medianos/Grandes (Google Sheets → `picking_tamanos`)

Pedido 2026-11-28. Este documento explica un puente de datos **temporal**:
mientras la operación de Picking Medianos/Grandes todavía se hace en la
planilla vieja (Google Sheets) en vez de en la pantalla "Picking Tamaños"
de este sistema, un proceso automático copia los escaneos de cada día a
nuestra base. El día que se corte el proceso viejo y todo el equipo
escanee directo acá, **este puente deja de hacer falta** — ver la sección
"Cómo cortarlo" al final.

## Cómo funciona hoy (fuera de este repo)

1. Durante el día se escanea en el archivo **principal** de Picking
   Medianos y Grandes (Google Sheets, no es este repo).
2. A las **00:00 ART**, un proceso de ese lado vuelca los escaneos del
   día a la hoja **"Historico"** de la planilla
   [Picking_historia](https://docs.google.com/spreadsheets/d/14hzHl977uKLmk3H_se8mhoQM5dgpPZdh94BP1rN2cUM/edit#gid=0),
   con 5 columnas: `ESCANEO`, `FECHA Y HORA` (`DD/MM/AAAA HH:MM:SS`),
   `TAMAÑO` (`Mediano`/`Grande`), `ID NORMALIZADO`, `TIPO DE ENVIO`
   (`Mercadolibre`/`Directo`/etc.) — mismo schema que ya se migró una vez
   a mano con `scripts/importar_picking_historico.py`.

## Qué agrega este puente

- **`scripts/ingesta_lightdata/importar_picking_diario.py`**: lee la hoja
  "Historico" vía la API de Google Sheets, se queda con los escaneos de
  **ayer** (fecha ART), deduplica por `id_normalizado` (si el mismo
  paquete se reescaneó más de una vez ese día, gana el escaneo más
  reciente — `Revisar_Manual` se repite legítimamente, nunca se pisa a
  sí mismo) y hace upsert en `public.picking_tamanos` — **misma tabla,
  mismo criterio** que ya usa `scripts/importar_picking_historico.py`
  (el backfill manual que trajo el histórico hasta 2026-11-23). El cruce
  contra `envios.tamano` lo sigue disparando solo el trigger de la base
  (`trg_cruzar_tamano_en_envios`), este script no lo toca.
- **`.github/workflows/picking_historico_diario.yml`**: corre ese script
  todos los días a las 02:00 ART (05:00 UTC), dos horas después del
  volcado de medianoche.
- **`scripts/ingesta_lightdata/requirements_picking_sheets.txt`**: las 2
  librerías nuevas que hacen falta (`google-api-python-client`,
  `google-auth`) — separadas del resto a propósito, para que cortar el
  puente sea borrar 3 archivos y nada más (ver "Cómo cortarlo").

## Setup (una sola vez)

Hace falta una **service account de Google** con permiso de **Lector**
sobre la planilla — el repo no puede generarla sola (necesita acceso a
Google Cloud Console).

1. En [Google Cloud Console](https://console.cloud.google.com/) (podés
   usar un proyecto existente o crear uno nuevo, no importa cuál):
   - `APIs & Services` → `Library` → buscar **Google Sheets API** →
     **Enable**.
   - `APIs & Services` → `Credentials` → `Create Credentials` →
     **Service Account**. Nombre sugerido: `picking-historico-lector`.
     No hace falta asignarle ningún rol de IAM a nivel proyecto.
   - Entrar a la service account recién creada → pestaña **Keys** →
     `Add Key` → `Create new key` → tipo **JSON** → se descarga un
     archivo `.json`. **Ese archivo es el secreto** — no subirlo a este
     repo ni a ningún lado público.
2. Abrir la planilla
   [Picking_historia](https://docs.google.com/spreadsheets/d/14hzHl977uKLmk3H_se8mhoQM5dgpPZdh94BP1rN2cUM/edit#gid=0)
   → botón **Compartir** → agregar el email de la service account (es
   el campo `client_email` del JSON descargado, algo como
   `picking-historico-lector@<proyecto>.iam.gserviceaccount.com`) con
   permiso **Lector** (Viewer) alcanza, no hace falta Editor.
3. En GitHub, `Settings` → `Secrets and variables` → `Actions` de este
   repo, agregar 2 secrets nuevos (no los usa ningún otro workflow
   todavía):
   - `GOOGLE_SHEETS_CREDENTIALS_JSON`: pegar el **contenido completo**
     del archivo `.json` descargado en el paso 1 (tal cual, con saltos
     de línea y todo — GitHub Secrets soporta valores multilínea).
   - `SUPABASE_DB_URL`: la misma connection string que ya se usa a mano
     con `scripts/aplicar_migracion.py` (Supabase → Connect → Session
     pooler → URI, con la contraseña real). Es distinta de
     `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (esos sí ya están
     configurados, son de la API REST; este es la conexión directa a
     Postgres, necesaria acá por el UPDATE condicional del upsert que
     el cliente REST no puede expresar).
4. Listo — el workflow ya va a correr solo a las 02:00 ART. Para probarlo
   sin esperar al cron: pestaña **Actions** de GitHub → "Importar Picking
   Medianos/Grandes (puente temporal)" → **Run workflow** (podés dejar
   el campo "fecha" vacío para que use ayer, o poner una fecha puntual
   `YYYY-MM-DD` para reprocesar un día específico).

## Verificar que está andando

- Pestaña **Actions** de GitHub → el workflow debe aparecer corriendo
  todos los días cerca de las 02:00 ART, en verde.
- En Supabase, `select count(*) from picking_tamanos where creado_en::date = (current_date - 1);`
  debería dar un número > 0 cada mañana.
- Desde el dashboard, la pantalla **Picking Tamaños** (o cualquier envío
  entregado el día anterior) debería mostrar el tamaño correcto sin
  tener que escanearlo a mano en nuestro sistema.

## Cómo cortarlo (cuando se migre la operación completa)

El día que el equipo empiece a escanear directo en la pantalla "Picking
Tamaños" de este sistema (en vez de la planilla vieja), este puente deja
de hacer falta. Para cortarlo:

1. Borrar (o deshabilitar) `.github/workflows/picking_historico_diario.yml`
   — alcanza con borrar el archivo, o si se prefiere no perder el
   historial del workflow, comentar el bloque `schedule:` dejando solo
   `workflow_dispatch:` (para poder seguir disparándolo a mano si hiciera
   falta un backfill puntual más adelante).
2. Borrar `scripts/ingesta_lightdata/importar_picking_diario.py` y
   `scripts/ingesta_lightdata/requirements_picking_sheets.txt` (opcional,
   prolijidad — no rompen nada si quedan sin usarse).
3. En GitHub, los secrets `GOOGLE_SHEETS_CREDENTIALS_JSON` y
   `SUPABASE_DB_URL` se pueden borrar si no se usan para nada más (ojo:
   `SUPABASE_DB_URL` podría reusarse a futuro si se automatiza
   `aplicar_migracion.py`, hoy es 100% manual).
4. En Google Cloud Console, borrar la service account
   `picking-historico-lector` (o sacarle el acceso a la planilla) si ya
   no hace falta para nada más.
5. `picking_tamanos` queda igual que como la deja este puente — no hace
   falta ninguna migración para "cerrar" la tabla, el escaneo en vivo de
   la app ya inserta/actualiza ahí mismo.

No hace falta tocar nada de la pantalla "Picking Tamaños" en sí (ya
funciona hoy, en paralelo) — lo único que se corta es la fuente de datos
externa.
