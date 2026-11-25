// Cliente de Supabase compartido por toda la app.
// Viene de index.html (Etapa 1 de migración a ES Modules, 2026-11-24).
// Usa el global "supabase" cargado por CDN en index.html.

// Publishable key: pensada para ir expuesta en el navegador. La
// protección real la dan las políticas RLS de Supabase (solo usuarios
// autenticados pueden leer `envios`/`envios_historial`), no el secreto
// de esta clave.
export const SUPABASE_URL = "https://pxbovlghjljrbrpjtcpr.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ap5oFuGA3ByxzbewtCVjmA_aP4IRY4M";

// Pedido 2026-11-25: la sesión se guarda en sessionStorage (no en
// localStorage, el default de supabase-js) para que cada PESTAÑA tenga su
// propia sesión — así se puede entrar con un usuario A en una pestaña y
// un usuario B en otra sin que cerrar sesión en una cierre la otra.
// Trade-off aceptado: la sesión ya no sobrevive a cerrar la pestaña (antes
// sí, por eso el login persistía al reabrir el navegador); ahora hay que
// loguearse de nuevo en cada pestaña nueva.
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: window.sessionStorage },
});
