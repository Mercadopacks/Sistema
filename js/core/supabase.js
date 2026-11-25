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
//
// Fix real 2026-11-25 (2da vuelta): cambiar el storage NO alcanzaba — el
// bug reportado era que, al cerrar sesión en una pestaña y volver a ella
// más tarde, aparecía la cuenta de OTRA pestaña (incluso habiendo
// generado antes un storageKey "único por pestaña" — ver intento previo
// en el historial de este archivo, seguía fallando con pestañas
// DUPLICADAS, que heredan ese id al copiarse el sessionStorage). Causa
// real: supabase-js abre un `BroadcastChannel` nombrado igual al
// `storageKey` para sincronizar el estado de auth entre pestañas (ver
// gotrue-js: `if(... && this.storageKey) this.broadcastChannel = new
// BroadcastChannel(this.storageKey)`) — pasa SIEMPRE que `storageKey`
// tenga un valor, sin importar qué storage se use. Dos pestañas con el
// mismo storageKey (el caso por default, y también 2 pestañas que alguna
// vez compartieron un id vía "duplicar pestaña") escuchan el MISMO canal:
// cualquier login/logout/refresh de token en una se propaga y termina
// pisando la sesión guardada en la otra.
// Fix definitivo: `storageKey: ""` — con ese valor "falsy", gotrue-js NO
// crea ningún BroadcastChannel para NINGUNA pestaña (ver el `&&
// this.storageKey` del guard de arriba), así que no hay canal que pueda
// cruzarse, ni siquiera entre pestañas duplicadas. No hace falta un id
// único por pestaña para el aislamiento del storage en sí: el
// sessionStorage del navegador YA aísla pestañas por su cuenta (cada
// pestaña tiene su propio compartimento, aunque usen el mismo nombre de
// clave) — lo único que cruzaba pestañas era el BroadcastChannel.
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: window.sessionStorage, storageKey: "" },
});
