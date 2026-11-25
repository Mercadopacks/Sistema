// Edge Function: cambia el email y/o la contraseña de un usuario YA
// EXISTENTE del dashboard beta.
//
// Igual que crear-usuario, esto necesita la service role key (cambiar el
// email/contraseña de una cuenta de Supabase Auth es una operación de
// administrador, no algo que el propio usuario logueado pueda hacer sobre
// otra cuenta) — por eso corre como Edge Function en vez de un simple
// `sb.from("perfiles_usuario").update(...)` desde el navegador, que sí
// alcanza para el resto de los campos del perfil (nombre, tipo_usuario,
// vistas permitidas, etc., ver js/admin/usuarios.js).
//
// Seguridad: mismo chequeo que crear-usuario — quien llama tiene que
// estar autenticado Y tener es_admin=true en su propio perfil.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Falta autenticación." }, 401);

    const clienteLlamador = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: errUser } = await clienteLlamador.auth.getUser();
    if (errUser || !user) return json({ error: "Token inválido." }, 401);

    const { data: perfilLlamador, error: errPerfil } = await clienteLlamador
      .from("perfiles_usuario")
      .select("es_admin")
      .eq("auth_user_id", user.id)
      .single();
    if (errPerfil || !perfilLlamador || !perfilLlamador.es_admin) {
      return json({ error: "No tenés permiso para editar usuarios." }, 403);
    }

    const body = await req.json();
    const { auth_user_id, email, password } = body || {};
    if (!auth_user_id) return json({ error: "Falta auth_user_id." }, 400);
    if (!email && !password) return json({ error: "No hay nada para cambiar." }, 400);
    if (password && String(password).length < 6) {
      return json({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const attrs: Record<string, unknown> = {};
    if (email) { attrs.email = email; attrs.email_confirm = true; }
    if (password) attrs.password = password;

    const { error: errAuth } = await admin.auth.admin.updateUserById(auth_user_id, attrs);
    if (errAuth) return json({ error: errAuth.message }, 400);

    // perfiles_usuario.email es una copia (para mostrar/buscar sin tener
    // que pegarle a Auth) — se mantiene sincronizada acá.
    if (email) {
      const { error: errPerfilUpd } = await admin
        .from("perfiles_usuario")
        .update({ email })
        .eq("auth_user_id", auth_user_id);
      if (errPerfilUpd) return json({ error: errPerfilUpd.message }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
