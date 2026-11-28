# Mercadopacks Sistema

Repo completo del nuevo sistema de logística de Mercadopacks, sobre
Supabase — separado del repo de producción (`mercadopacks-metricas-diarias`,
Firestore) desde 2026-11-16. Ver `docs/reglas_de_negocio.md` para el
detalle completo de reglas de negocio, esquema de base de datos y
arquitectura.

## Estructura de carpetas

```
index.html, assets/            el dashboard (estático, GitHub Pages)
docs/                          toda la documentación de negocio/arquitectura
.claude/skills/                skills de Claude Code específicos de este repo
scripts/
  ingesta_lightdata/           pipeline de LightData -> Supabase (se importan entre sí, van juntos)
  fallidos_y_cambios/          scripts activos de esa sección (cron diario)
  qa/                          scripts de testing/regresión
  migraciones_python_unicas/   backfills de una sola vez, ya ejecutados (archivo histórico)
  migraciones/                 SQL para correr a mano en el SQL Editor de Supabase
supabase/functions/            Edge Functions
datos_crudos/                  exports de LightData descargados (no versionados)
.github/workflows/             automatización (GitHub Actions)
```

Los scripts de `ingesta_lightdata/` se importan entre sí con rutas
relativas de archivo (sin paquete/`__init__.py`) — si alguno se mueve,
hay que revisar `sys.path.insert(...)` en los que lo importan
(`fallidos_y_cambios/`, `qa/` y `migraciones_python_unicas/` ya apuntan
a `../ingesta_lightdata`).

## Qué hay en cada carpeta

- **`index.html` + `assets/`**: el dashboard en sí, publicado vía GitHub
  Pages en `https://mercadopacks.github.io/Sistema/`. Lee/escribe datos
  de Supabase directamente desde el navegador.
- **`scripts/ingesta_lightdata/`**: ingesta de LightData -> Supabase
  (`publicar_supabase.py`), más `descargar_lightdata.py`/
  `fecha_descarga.py`/`generar_reporte.py` — **copias deliberadas** del
  repo de producción, no un submódulo — y `sincronizar_lightdata.py`
  (trae el listado de usuarios de Lightdata, `--live` o un .xlsx
  exportado a mano, para crear/vincular repartidores en
  `choferes_roster`; ver `docs/integracion_usuarios_lightdata.md`) +
  `vincular_choferes_envios.py` (completa `chofer_lightdata_id`/
  `estado`/`logistica_inversa_real` en vivo). Usa una **cuenta de
  LightData propia** (`LIGHTDATA_USER`/`LIGHTDATA_PASS` de este repo),
  distinta de la de producción. Ver `docs/reglas_de_negocio.md` sección 0.
- **`scripts/fallidos_y_cambios/backfill_estado_fallidos_viejos.py`**:
  corre 1 vez por día desde el cron (`backfill_fallidos_diario.yml`)
  para reconciliar contra Lightdata los casos de Fallidos/Cambios que
  quedan fuera de la ventana de refresco en vivo normal.
- **`scripts/qa/qa_validar_estado_vivo.py`**: test de regresión de solo
  lectura, compara Lightdata en vivo contra `envios.estado`.
- **`scripts/migraciones_python_unicas/`**: backfills de una sola vez ya
  ejecutados contra producción — quedan de archivo/referencia, no se
  vuelven a correr ni son parte de ningún cron.
- **`scripts/migraciones/`**: SQL para correr a mano en el SQL Editor de
  Supabase (no hay migraciones automáticas todavía).
- **`supabase/functions/crear-usuario/`**: Edge Function que crea la
  cuenta de Supabase Auth + el perfil de un usuario nuevo — es la única
  forma de dar de alta un usuario (necesita la service role key, que
  nunca va en el navegador).
- **`.github/workflows/publicar_supabase.yml`**: automatiza el pipeline
  de ingesta (disparado por cron-job.org, no por `schedule:` nativo de
  GitHub Actions — ver el workflow para por qué). **`backfill_fallidos_diario.yml`**:
  corre la reconciliación diaria de Fallidos/Cambios. **`picking_historico_diario.yml`**:
  puente TEMPORAL que importa los escaneos de Picking Medianos/Grandes
  desde Google Sheets (`scripts/ingesta_lightdata/importar_picking_diario.py`)
  mientras esa operación no esté 100% migrada a este sistema — ver
  `docs/migracion_picking_historico.md` para el setup y cómo cortarlo.
- **`docs/`**: `reglas_de_negocio.md` (reglas de negocio, esquema de BD,
  arquitectura — leer antes de tocar cualquier cosa), `diccionario_de_datos.md`
  (columnas del export crudo de LightData), `integracion_usuarios_lightdata.md`,
  `lightdata_api_envios.md` (referencia técnica del endpoint interno),
  `qa_fallidos_estado.md` (batería de test de esa sección) y
  `migracion_picking_historico.md` (puente temporal Google Sheets ->
  `picking_tamanos`, con el setup y cómo cortarlo).
- **`.claude/skills/`**: skills de Claude Code propios de este repo
  (reglas de UI, cómo levantar el entorno local).

## Para seguir desarrollando

1. Leer `docs/reglas_de_negocio.md` completo antes de tocar el
   dashboard — tiene las reglas de diseño obligatorias (sección 1), el
   esquema de base de datos (sección 2), las reglas de Fallidos y
   Cambios (sección 3), el sistema de usuarios/permisos (sección 4) y
   los componentes de UI reutilizables (sección 5).
2. Para correr los scripts de `scripts/ingesta_lightdata/` en local,
   hace falta un `scripts/.env` con `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `LIGHTDATA_USER`, `LIGHTDATA_PASS` (no
   versionado, ver `.gitignore`) — Python lo busca relativo al script
   que se ejecuta, así que ese único `.env` en `scripts/` sirve para
   todas las subcarpetas.
3. Para desplegar cambios a la Edge Function:
   `supabase functions deploy crear-usuario` (necesita `supabase login` +
   `supabase link --project-ref <ref>` una vez).
