# Mercadopacks Sistema

Dashboard web del nuevo sistema de logística de Mercadopacks (Supabase),
publicado vía GitHub Pages en `https://mercadopacks.github.io/Sistema/`.

Es solo la página estática (`index.html` + `assets/`) — lee datos de
Supabase directamente desde el navegador. Los scripts de ingesta
(descarga de LightData, publicación a Supabase, el workflow de GitHub
Actions que los automatiza, y la Edge Function de alta de usuarios) siguen
viviendo en el repo `mercadopacks-metricas-diarias`, junto con el pipeline
de producción (Firestore), porque ambos comparten el mismo login de
LightData y necesitan coordinarse entre sí (concurrency group de GitHub
Actions — eso solo funciona dentro de un mismo repo).

Para actualizar este dashboard: editar `index.html` acá, o editar
`logistica-metricas/dashboard/beta/index.html` en el otro repo y copiar el
archivo (ajustando las rutas de `assets/`, ver el historial de commits
para el ejemplo).
