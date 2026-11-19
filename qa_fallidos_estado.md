# QA — Confiabilidad de estados en Fallidos y Cambios

Batería de test para la clase de bugs del 2026-11-19 (3 incidentes
seguidos, todos en el mismo mecanismo: `envios.estado` desincronizado o
mal traducido respecto de Lightdata). Ver `reglas_de_negocio.md`,
changelog 2026-11-19, para el detalle de cada bug real que motivó cada
caso de test de acá abajo.

## Por qué importa

Fallidos y Cambios es la pantalla que el sector usa para reclamarle a un
repartidor un paquete. Si `estado` queda desactualizado o mal traducido:

- Un paquete YA entregado puede seguir pidiéndose al repartidor (le
  hacen perder tiempo, mala experiencia).
- Un paquete que SÍ falló puede desaparecer de la vista (se pierde el
  seguimiento, puede terminar perdido de verdad).

Por eso cualquier cambio en `vincular_choferes_envios.py`,
`publicar_supabase.py`, `cargarFallidos()`/`determinarTipoDestinoFallido()`
(`index.html`) o las migraciones relacionadas con `envios.estado` tiene
que pasar esta batería antes de darse por terminado.

## Test automatizado: `scripts/qa_validar_estado_vivo.py`

Compara, para una muestra real (todo el rango de `RANGO_DIAS_LIVE` días
que usa el script en vivo), lo que Lightdata dice AHORA contra lo que hay
guardado en Supabase. Es de solo lectura en los dos lados.

```
cd scripts
python qa_validar_estado_vivo.py [--rango-dias N]
```

Sale con código 0 (OK) o 1 (FALLÓ) — se puede engancharse a CI o correrlo
a mano después de cualquier deploy que toque este flujo.

| # | Qué chequea | Bug real que lo motivó |
|---|---|---|
| 1 | Ningún `envios.estado` es un número crudo (`^\d+$`) | 2026-11-19 parte 2: `estado_envio` es un código, no texto — se guardaba el código sin traducir |
| 2 | `envios.estado` coincide con lo que Lightdata dice AHORA, para toda la muestra | 2026-11-19 parte 1 y 3: no se guardaba, o solo se refrescaban los envíos de hoy |
| 3 | `"A retirar"` no está configurado en `parametros_fallidos_mapeo` (informativo, no bloqueante — el frontend ya lo excluye de forma defensiva) | Relacionado al punto 1 del pedido del usuario del 2026-11-19 |

## Casos manuales (checklist, correr después de cualquier cambio al pipeline de estados)

Elegir 3-5 tracking de prueba: uno de hoy, uno de ayer, uno de hace
3-5 días (dentro del umbral "Revisar"), uno "A retirar" real, uno recién
entregado en Lightdata.

1. **Entregado hace poco, en Fallidos**: elegir un tracking que figure
   "No entregado"/"Nadie"/similar en el sistema, ir a Lightdata y marcarlo
   como entregado (o esperar a que lo entreguen de verdad), correr
   `vincular_choferes_envios.py` y confirmar que:
   - `envios.estado` pasa a "Entregado" (texto, no código).
   - El tracking YA NO aparece en Fallidos y Cambios (ni en "Por
     repartidor" ni en "Por Envíos").
   - Referencia: caso real tracking 48514057705.

2. **"A retirar" nunca es fallido**: tomar un envío con `estado = "A
   retirar"` real en Lightdata, confirmar que NO aparece en Fallidos y
   Cambios aunque tenga logística inversa marcada o esté en
   `parametros_fallidos_mapeo`.

3. **Antigüedad > 1 día se sigue refrescando**: tomar un tracking de
   hace 2-4 días que siga pendiente, cambiarle el estado en Lightdata (o
   esperar un cambio real), correr el script y confirmar que el cambio
   se refleja en `envios.estado` dentro de los `RANGO_DIAS_LIVE`
   configurados (default 15 días) — no solo si es de hoy.
   - Referencia: caso real tracking 48553756312 (2 días de antigüedad,
     Lightdata decía "Cancelado", el sistema seguía mostrando "Nadie").

4. **Texto, nunca código**: para cualquier envío de la muestra, abrir
   Fallidos y Cambios y confirmar visualmente que la columna "Estado"
   siempre muestra un nombre (ej. "Cancelado"), nunca un número suelto
   (ej. "8"). Cruzar contra el desplegable "Estado" de la pantalla de
   Lightdata para ese mismo tracking — tienen que decir lo mismo.

5. **Nombres de repartidor en Title Case**: en Fallidos, Asistencia,
   Seguimiento en Ruta y el ABM de Repartidores, confirmar que todos los
   nombres se ven con el mismo formato (`Juan Pérez`, no `JUAN PÉREZ` ni
   `juan pérez`) sin importar cómo vino el dato original de Lightdata.

## Alcance no cubierto (medido, no asumido)

`RANGO_DIAS_LIVE` (default 3 días) es un límite REAL de Lightdata, no una
elección arbitraria. Se probó en vivo (dry-run real) con 3/5/7 días:

| Rango | Resultado |
|---|---|
| 3 días | ~23s, 7.388 filas, OK |
| 5 días | colgado 8+ min sin responder ni tirar error |
| 7 días | colgado 8+ min sin responder ni tirar error (con timeout de request subido a 60s igual) |

Conclusión: el endpoint de Lightdata se degrada de forma NO lineal pasado
cierto rango de fechas — no es algo que se arregle subiendo nuestro
timeout ni el `RANGO_DIAS_LIVE`, hacerlo cuelga el ciclo entero y rompe
la cadencia de 10 min (peor que el bug original). Por eso el refresco en
vivo cubre hasta 3 días de antigüedad, no los 5 días del umbral
"Revisar" — un caso que llega a "Revisar" sin resolverse deja de
refrescarse en vivo (pero sí lo sigue viendo el equipo, que es
justamente para qué existe ese umbral: para que alguien lo mire a mano).

**Si en el futuro hace falta cubrir ese hueco**, la alternativa correcta
NO es subir `RANGO_DIAS_LIVE` (ya medido que no funciona) sino apuntar la
consulta directo a los `tracking_number`/`did` puntuales que siguen
pendientes en `fallidos_seguimiento`/Fallidos (típicamente decenas, no
miles), con una consulta chica por cada uno o por lotes acotados — mismo
principio que ya usa `publicar_supabase.py` para otras cosas, evitar
barrer por fecha cuando se puede apuntar directo al dato que importa.

## Notas para quien edite el pipeline de estados a futuro

- `CODIGOS_ESTADO` en `vincular_choferes_envios.py` es la tabla de
  traducción código→texto. Si Lightdata agrega un código nuevo que no
  está ahí, `texto_estado()` lo deja pasar tal cual (no rompe, pero
  tampoco traduce) — revisar los logs del Action de vez en cuando por si
  aparece algún estado con pinta de número.
- Los códigos 3, 11, 22 y 30 de `CODIGOS_ESTADO` están tomados de
  `lightdata_api_envios.md` §4.1 pero NO fueron verificados contra una
  consulta real (a diferencia de 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 31,
  que sí están confirmados contra `parametros_fallidos_mapeo` o
  comparaciones reales en el código). Si alguno de esos 4 aparece
  seguido en producción, conviene verificarlo igual que se hizo acá con
  el tracking 48553756312 (ver sección "Diagnóstico puntual" más abajo)
  antes de confiar en el texto.

## Diagnóstico puntual (cómo se verificó el bug del código numérico)

Para confirmar qué código devuelve Lightdata para un tracking puntual,
sin tocar Supabase:

```python
# Reusa FILTROS_DEFAULT/COLUMNAS_DEFAULT de vincular_choferes_envios.py,
# cambiando solo "tracking_number" en los filtros y logueando con
# Playwright igual que el resto del script. Imprime la fila cruda del
# endpoint — ahí se ve `estado_envio` (código) y `estadoml` (que para
# estados de Lightdata, no de ML, a veces coincide con el texto real y
# sirve de referencia cruzada rápida).
```
