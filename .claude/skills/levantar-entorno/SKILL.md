---
name: levantar-entorno
description: Levanta el entorno local de Mercadopacks Sistema (dashboard estático index.html servido localmente + scripts de Python contra Lightdata/Supabase). Usar cuando el usuario pida arrancar, levantar, probar o abrir el dashboard localmente, o para correr cualquier script de scripts/ a mano.
---

# Levantar entorno local — Mercadopacks Sistema

Este proyecto **no tiene backend propio ni build step**: `index.html` es
HTML/JS vanilla que habla directo con Supabase desde el navegador. "Levantar
el entorno" acá es: (1) servir `index.html` por HTTP (no abrirlo con
`file://`, porque algunas APIs del navegador y los módulos no funcionan bien
así) y (2) tener `scripts/.env` listo si hace falta correr algún script de
Python.

## 1. Servir el dashboard

- Antes de levantar uno nuevo, revisar si ya hay un servidor viejo colgado de
  una sesión anterior (bug real ya visto: ~15 procesos Python zombis
  acumulados en el puerto 8080 de corridas previas que nunca se cerraron).
  En PowerShell: `Get-NetTCPConnection -LocalPort 8080,8090 -ErrorAction SilentlyContinue`
  y, si hay algo viejo que ya no responde, limpiarlo antes de levantar uno
  nuevo en vez de sumar otro proceso encima.
- Levantar un server simple desde la raíz del repo:
  ```
  python -m http.server 8090
  ```
  y abrir `http://127.0.0.1:8090/index.html`.
- No hace falta nada más (no hay `npm install`, no hay paso de build) — es
  HTML estático.

## 2. Scripts de Python (`scripts/`)

Necesitan `scripts/.env` (no versionado) con `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `LIGHTDATA_USER`, `LIGHTDATA_PASS`. Ese único
`.env` sirve para todas las subcarpetas (`ingesta_lightdata/`,
`fallidos_y_cambios/`, `qa/`, `migraciones_python_unicas/`) porque
`load_dotenv()` busca hacia arriba en el árbol de directorios.

Instalar dependencias una vez: `pip install -r scripts/requirements.txt -r scripts/requirements_supabase.txt`
(Playwright además necesita `playwright install chromium` la primera vez).

Para correr un script puntual, parado en su propia carpeta (ej.
`scripts/fallidos_y_cambios/`): `python backfill_estado_fallidos_viejos.py --dry-run`
primero si el script lo soporta, antes de la corrida real contra producción.

## Notas

- Los scripts que pegan a Lightdata vía Playwright pueden tardar varios
  minutos (ej. `vincular_choferes_envios.py` ~3-13 min según el rango;
  `backfill_estado_fallidos_viejos.py` puede tardar más de 10 min con
  cientos de candidatos) — correrlos en background y esperar la notificación
  en vez de bloquear la terminal.
- Si un script que antes andaba bien empieza a colgarse sin error en esta
  máquina en particular, puede ser un problema puntual del entorno local (ya
  visto en este proyecto) — antes de asumir que es un bug de código, probar
  si el mismo script anda bien corrido desde GitHub Actions o pedirle al
  usuario que lo corra en su máquina.
