-- FIX URGENTE (2026-11-24): la migración 2026-11-24h sacó la política
-- "autenticados pueden leer envios" de `envios` asumiendo que era un
-- duplicado inútil de "acceso por cliente: envios". Error real: esa
-- segunda política es RESTRICTIVA (polpermissive=false), no permisiva —
-- es la mitad "narrow" de un patrón permisiva+restrictiva a propósito
-- (permisiva = acceso base; restrictiva = lo acota por cliente). Una
-- política RESTRICTIVA sola, sin ninguna PERMISIVA, no otorga nada — se
-- combinan como (OR de permisivas) AND (AND de restrictivas), así que sin
-- permisivas el resultado es "nada" para TODOS, administradores
-- incluidos. Confirmado en vivo: puede_ver_envio_de_cliente(271) daba
-- true para un admin real, pero `select * from envios where
-- did_cliente=271` bajo su mismo contexto RLS devolvía 0 filas — eso
-- rompió toda la grilla de Liquidación Clientes en producción.
--
-- Se repone la política permisiva (qual=true), que combinada con la
-- restrictiva ya existente vuelve a dar el comportamiento correcto y
-- seguro: admin ve todo, cliente solo lo suyo (true AND
-- puede_ver_envio_de_cliente(...) = puede_ver_envio_de_cliente(...)).

create policy "autenticados pueden leer envios" on public.envios
  for select to authenticated using (true);

notify pgrst, 'reload schema';
