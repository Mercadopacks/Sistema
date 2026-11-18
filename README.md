# Mercadopacks Sistema

Repo completo del nuevo sistema de logística de Mercadopacks, sobre
Supabase — separado del repo de producción (`mercadopacks-metricas-diarias`,
Firestore) desde 2026-11-16. Ver `reglas_de_negocio.md` para el detalle
completo de reglas de negocio, esquema de base de datos y arquitectura.

## Qué hay acá

- **`index.html` + `assets/`**: el dashboard en sí, publicado vía GitHub
  Pages en `https://mercadopacks.github.io/Sistema/`. Lee/escribe datos
  de Supabase directamente desde el navegador.
- **`scripts/`**: ingesta de LightData -> Supabase
  (`publicar_supabase.py`), más `descargar_lightdata.py`/
  `fecha_descarga.py`/`generar_reporte.py` — **copias deliberadas** del
  repo de producción, no un submódulo. Usa una **cuenta de LightData
  propia** (`LIGHTDATA_USER`/`LIGHTDATA_PASS` de este repo), distinta de
  la de producción — así los dos pipelines nunca se cruzan. Ver
  `reglas_de_negocio.md` sección 0 para el detalle.
- **`scripts/sincronizar_lightdata.py`**: trae el listado de usuarios de
  Lightdata (`--live`, pega directo al endpoint interno vía Playwright;
  o un .xlsx exportado a mano como respaldo) y lo usa para crear/vincular
  repartidores en `choferes_roster` automáticamente. Ver
  `integracion_usuarios_lightdata.md` (raíz del repo).
- **`scripts/migraciones/`**: SQL para correr a mano en el SQL Editor de
  Supabase (no hay migraciones automáticas todavía).
- **`supabase/functions/crear-usuario/`**: Edge Function que crea la
  cuenta de Supabase Auth + el perfil de un usuario nuevo — es la única
  forma de dar de alta un usuario (necesita la service role key, que
  nunca va en el navegador).
- **`.github/workflows/publicar_supabase.yml`**: automatiza
  `publicar_supabase.py` (disparado por cron-job.org, no por `schedule:`
  nativo de GitHub Actions — ver el workflow para por qué).
- **`diccionario_de_datos.md`**: qué trae cada columna del export crudo
  de LightData (copia del mismo archivo en el repo de producción).

## Para seguir desarrollando

1. Leer `reglas_de_negocio.md` completo antes de tocar el dashboard —
   tiene las reglas de diseño obligatorias (sección 1), el esquema de
   base de datos (sección 2), las reglas de Fallidos y Cambios (sección
   3), el sistema de usuarios/permisos (sección 4) y los componentes de
   UI reutilizables (sección 5).
2. Para correr `publicar_supabase.py` en local, hace falta un
   `scripts/.env` con `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `LIGHTDATA_USER`, `LIGHTDATA_PASS` (no versionado, ver `.gitignore`).
3. Para desplegar cambios a la Edge Function:
   `supabase functions deploy crear-usuario` (necesita `supabase login` +
   `supabase link --project-ref <ref>` una vez).
