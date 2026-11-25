// Cliente de Supabase compartido por toda la app.
// Viene de index.html (Etapa 1 de migración a ES Modules, 2026-11-24).
// Usa el global "supabase" cargado por CDN en index.html.

// Publishable key: pensada para ir expuesta en el navegador. La
// protección real la dan las políticas RLS de Supabase (solo usuarios
// autenticados pueden leer `envios`/`envios_historial`), no el secreto
// de esta clave.
export const SUPABASE_URL = "https://pxbovlghjljrbrpjtcpr.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ap5oFuGA3ByxzbewtCVjmA_aP4IRY4M";

export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
