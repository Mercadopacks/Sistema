-- Bug real 2026-11-23: `envios` nunca tuvo grant de UPDATE para
-- `authenticated` (solo lo escribe el pipeline de Lightdata, con la
-- service role key) — intencional, porque nadie debería poder reescribir
-- un envío entero desde el navegador. Pero los triggers que cruzan
-- Tamaño/Cordón (fn_cruzar_tamano_en_envios, fn_cruzar_cordon_en_envios)
-- son SECURITY INVOKER: cuando un usuario autenticado dispara el trigger
-- (escaneando un paquete, o editando un mapeo de Localidad+CP), el UPDATE
-- interno corre con LOS PERMISOS DE ESE USUARIO, no con los del dueño de
-- la función — y como `authenticated` no tenía UPDATE en `envios`, el
-- trigger fallaba con "permission denied for table envios", abortando
-- TODO el insert/update que lo disparó ("No se pudo guardar.").
--
-- Mismo bug afectaba al cruce de Tamaño desde el principio, pero quedaba
-- oculto: el código viejo hacía ese UPDATE como una llamada JS aparte (no
-- atómica con el insert de picking_tamanos) y solo lo logueaba a
-- console.error sin avisar en pantalla — por eso nunca se vio como error
-- visible, aunque tampoco estuviera actualizando nada de verdad.
--
-- Fix: grant de UPDATE acotado SOLO a las 2 columnas que estos triggers
-- tocan (no se habilita reescribir el envío entero desde el navegador,
-- se mantiene la intención original de que el resto del envío es de
-- solo lectura para la app).
grant update (tamano, cordon_id) on public.envios to authenticated;

notify pgrst, 'reload schema';
