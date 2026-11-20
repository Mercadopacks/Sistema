---
name: mercadopacks-sistema-ui-rules
description: Reglas de diseño e implementación de UI de este proyecto (Mercadopacks Sistema — dashboard HTML/JS vanilla en index.html, sin frameworks). Usar SIEMPRE que se cree o modifique una pantalla, ABM, combo, modal o componente visual dentro de index.html, para mantener consistencia visual, de accesibilidad y de arquitectura con el resto de la app.
---

# Reglas de UI — Mercadopacks Sistema

Este proyecto es **HTML + JS vanilla en un único `index.html`** (sin React, sin
build step, sin componentes propios tipo `ui.tsx`) — es un stack distinto al de
otros proyectos de Mercadopacks (ej. "Liquidación de Sueldos", que sí es
React + FastAPI). No asumir componentes o convenciones de ese otro proyecto acá.

## Fuente de verdad: `docs/reglas_de_negocio.md`, sección 1

Las reglas completas y actualizadas viven en
`docs/reglas_de_negocio.md` (sección 1, "Reglas de diseño del dashboard") — **leer
esa sección completa antes de tocar `index.html`**, no confiar solo en este
resumen (esta skill no duplica el texto para no desincronizarse; léela siempre
de la fuente).

Puntos más fáciles de pasar por alto (resumen, no reemplazo de la lectura completa):

1. Todo ABM (listado con alta/edición/borrado) usa: filas en modo lectura (nunca
   `<input>` editable suelto en celda), columna "Opciones" a la derecha con
   íconos Lucide (lápiz/tacho), modal compartido para alta y edición (nunca
   `prompt()`), campos de opciones fijas con su propio combo/ABM (nunca texto
   libre para datos de lista cerrada).
2. Excepción explícita: pantallas operativas "en vivo" (ej. Asistencia de hoy)
   sí usan edición inline a propósito — ante la duda de cuál aplica, preguntar.
3. Combos/popovers usan el singleton compartido `crearComboGenerico`/
   `crearPopoverGenerico` — nunca un estado `yaAbierto` aislado por componente.
4. Orden de declaración: cualquier elemento enganchado con `addEventListener`
   al nivel superior del script debe existir en el HTML ANTES del `<script>`;
   cualquier `const`/`let` compartido (registro, cache, singleton) se declara
   ARRIBA de todo el `<script>`, nunca justo antes de donde se usa (TDZ —
   rompe TODO el script top-level, no solo ese módulo).
5. **Antes de dar un cambio de JS por terminado, ejecutarlo de verdad** (jsdom +
   mocks mínimos de `supabase`/`lucide`), no solo revisar que no tenga errores
   de sintaxis — `new Function(codigo)` no alcanza.
6. **Todo texto libre que venga de la base** (Lightdata/Excel, no texto cargado
   a mano por un usuario del sistema) se muestra pasado por `tituloTexto()`
   (Primera Letra Mayúscula) — nunca al valor usado para comparar/filtrar/
   agrupar, que sigue siendo el crudo de la base.
7. Paleta fija: dorado `#F6BE05` + negro, fondo `#efeeea`, tarjetas blancas.
   Fuente Nunito, íconos Lucide (nunca emojis como ícono), sidebar lateral.
8. Chips (pastilla, `border-radius:20px`) vs. campos de entrada (rectos,
   `border-radius:8px`, fondo blanco) — nunca mezclar los dos estilos. Filtro
   de columna con opciones fijas = combo propio, nunca `<select>` nativo.

## Antes de dar por terminada una pantalla nueva

1. ¿Las filas de un ABM son de solo lectura, con modal para alta/edición?
2. ¿Los combos/popovers usan `crearComboGenerico`/`crearPopoverGenerico`?
3. ¿El texto que viene de Lightdata/Excel se muestra con `tituloTexto()`,
   sin tocar el valor crudo usado para filtrar/agrupar?
4. ¿El script se ejecutó de verdad (jsdom), no solo se revisó la sintaxis?
5. ¿Paleta, fuente e íconos coinciden con el resto del dashboard?
6. Si hay dudas de accesibilidad/UX más finas, consultar la skill
   `ui-ux-pro-max` (disponible a nivel de cuenta/sesión) antes de improvisar.
