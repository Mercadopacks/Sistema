"""
Sincroniza la base de usuarios de Lightdata con lightdata_usuarios y
choferes_roster. Ver integracion_usuarios_lightdata.md (raíz del repo)
para el detalle completo.

Dos formas de traer los usuarios de Lightdata:

- `--live` (versión 2, en vivo): inicia sesión en Lightdata con Playwright
  (mismas LIGHTDATA_USER/LIGHTDATA_PASS que descargar_lightdata.py) y pega
  directo al endpoint interno que usa la pantalla Sistema > Usuarios
  (modules/system_users/listado/procesar_listado.php — ver sección 2.2 del
  .md). Pensado para correr solo, sin intervención manual (ej. como paso
  extra de publicar_supabase.yml).
- Ruta a un .xlsx (versión 1, manual): hoja "Usuarios", columnas
  ID/Nombre/Apellido/Usuario/Perfil/Habilitado/Bloqueado/Codigo_empleado
  (ver sección 2.1 del .md) — exportado a mano desde Lightdata con el
  script de consola de la sección 2.3. Sirve de respaldo si Lightdata
  cambia el endpoint interno y `--live` deja de andar.

Uso:
    python sincronizar_lightdata.py --live [--dry-run]
    python sincronizar_lightdata.py ruta/al/usuarios_lightdata.xlsx [--dry-run]

Necesita en el entorno (o en scripts/.env): SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, y para --live también LIGHTDATA_USER/LIGHTDATA_PASS.
"""

import os
import re
import sys
import unicodedata
from urllib.parse import quote_plus

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

COLUMNAS_ESPERADAS = [
    "ID", "Nombre", "Apellido", "Usuario", "Perfil", "Habilitado", "Bloqueado",
]

LIGHTDATA_URL = "https://mercadopacks.lightdata.app/"
LIGHTDATA_ENDPOINT_USUARIOS = LIGHTDATA_URL + "modules/system_users/listado/procesar_listado.php"
TIMEOUT_MS = 20_000


def normalizar(texto):
    """trim + colapsar espacios + minúsculas + sin acentos + solo letras/números/espacio."""
    if texto is None:
        return ""
    texto = str(texto).strip().lower()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = re.sub(r"[^a-z0-9\s]", "", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def _es_si(valor):
    """Habilitado/Bloqueado vienen como 'Si'/'No' del Excel, o 1/0 del endpoint en vivo."""
    if isinstance(valor, bool):
        return valor
    if isinstance(valor, (int, float)):
        return valor == 1
    return str(valor).strip().lower() == "si"


def construir_registro(id_, nombre, apellido, usuario, perfil, habilitado, bloqueado, codigo_empleado):
    nombre = (nombre or "").strip()
    apellido = (apellido or "").strip()
    usuario = (usuario or "").strip()
    perfil = (perfil or "").strip()
    codigo = "" if codigo_empleado is None else str(codigo_empleado).strip()
    return {
        "lightdata_id": int(id_),
        "nombre": nombre,
        "apellido": apellido,
        "usuario": usuario,
        "usuario_norm": normalizar(usuario),
        "nombre_completo_norm": normalizar(f"{nombre} {apellido}"),
        "perfil": perfil,
        "habilitado": _es_si(habilitado),
        "bloqueado": _es_si(bloqueado),
        "codigo_empleado": None if codigo in ("", "0") else codigo,
        "activo_en_ultima_import": True,
    }


def cargar_excel(ruta):
    df = pd.read_excel(ruta, sheet_name="Usuarios", dtype=str)
    faltantes = [c for c in COLUMNAS_ESPERADAS if c not in df.columns]
    if faltantes:
        raise ValueError(f"Faltan columnas en el Excel: {faltantes}")

    registros = []
    for _, fila in df.iterrows():
        codigo_raw = fila.get("Codigo_empleado")
        registros.append(construir_registro(
            fila["ID"], fila["Nombre"], fila["Apellido"], fila["Usuario"], fila["Perfil"],
            fila.get("Habilitado"), fila.get("Bloqueado"),
            None if pd.isna(codigo_raw) else codigo_raw,
        ))
    return registros


def _jquery_param(obj):
    """
    Replica jquery.param(obj) (modo NO tradicional, el default de $.ajax):
    objetos -> name[subkey], arrays de objetos -> name[i][subkey], arrays de
    valores sueltos -> name[]=valor. Es el formato que espera
    procesar_listado.php (ver sección 2.2 del .md, "formato jQuery $.ajax").
    """
    pares = []

    def add(key, value):
        if value is None:
            value = ""
        elif isinstance(value, bool):
            value = "true" if value else "false"
        pares.append((key, str(value)))

    def build(prefix, value):
        if isinstance(value, list):
            for i, v in enumerate(value):
                if isinstance(v, (dict, list)):
                    build(f"{prefix}[{i}]", v)
                else:
                    build(f"{prefix}[]", v)
        elif isinstance(value, dict):
            for k, v in value.items():
                build(f"{prefix}[{k}]", v)
        else:
            add(prefix, value)

    for k, v in obj.items():
        build(k, v)

    return "&".join(f"{quote_plus(k)}={quote_plus(v)}" for k, v in pares)


def obtener_usuarios_en_vivo(usuario, clave):
    """
    Inicia sesión en Lightdata (mismo flujo que descargar_lightdata.py, ver
    ese script si LightData cambia el login) y pide el listado completo de
    usuarios al endpoint interno. Devuelve la lista cruda de filas (una por
    usuario, con las claves did/nombre/apellido/usuario/perfil/habilitado/
    bloqueado/codigo_empleado).
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(TIMEOUT_MS)
        try:
            page.goto(LIGHTDATA_URL)
            page.get_by_role("textbox", name="Username").fill(usuario)
            page.get_by_role("textbox", name="Password").fill(clave)
            page.get_by_text("Ingresar").click()
            # Ni "networkidle" ni "load" son confiables acá (bug real
            # 2026-11-18: el login es por AJAX, no navegación de página — el
            # "load" dispara para la pantalla de login, antes de que la
            # sesión quede armada). Mismo patrón que ya usa
            # descargar_lightdata.py: esperar un diálogo opcional de sesión
            # previa, y después un elemento real de la pantalla ya logueada
            # (el auto-wait de Playwright hace el resto).
            try:
                page.get_by_role("button", name="OK").click(timeout=5000)
            except PlaywrightTimeoutError:
                pass
            page.get_by_role("link", name="local_shipping Envios").wait_for()

            payload = {
                "cantxpagina": 5000,
                "pagina": 1,
                "filtros": {"nombre": "", "apellido": "", "usuario": "", "perfil": "-1"},
                "columnas": [
                    {"id": 41, "CDB": "nombre", "checked": True, "orden": ""},
                    {"id": 42, "CDB": "apellido", "checked": True, "orden": ""},
                    {"id": 43, "CDB": "usuario", "checked": True, "orden": ""},
                    {"id": 44, "CDB": "perfil", "checked": True, "orden": ""},
                    {"id": 45, "CDB": "habilitado", "checked": True, "orden": ""},
                    {"id": 46, "CDB": "bloqueado", "checked": True, "orden": ""},
                ],
                "empresa": 253,
            }
            resp = page.request.post(
                LIGHTDATA_ENDPOINT_USUARIOS,
                data=_jquery_param(payload),
                headers={
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
            )
            if not resp.ok:
                raise RuntimeError(f"Lightdata respondió {resp.status} al pedir el listado de usuarios (¿cambió el endpoint o el login?).")
            cuerpo = resp.json()
            filas = cuerpo.get("rows")
            if filas is None:
                raise RuntimeError(f"La respuesta no tiene 'rows' — Lightdata puede haber cambiado el formato. Respuesta: {cuerpo!r}")
            # Ver nota en vincular_choferes_envios.py: PHP puede serializar
            # un array no contiguo como objeto JSON (claves "0","1",...) en
            # vez de lista — no pasó acá todavía (una sola página, 5000 por
            # página), pero es la misma API, mismo riesgo.
            if isinstance(filas, dict):
                filas = list(filas.values())
            return filas
        finally:
            context.close()
            browser.close()


def cargar_en_vivo(usuario, clave):
    filas = obtener_usuarios_en_vivo(usuario, clave)
    return [
        construir_registro(
            f["did"], f.get("nombre"), f.get("apellido"), f.get("usuario"), f.get("perfil"),
            f.get("habilitado"), f.get("bloqueado"), f.get("codigo_empleado"),
        )
        for f in filas
    ]


def detectar_duplicados(registros):
    vistos = {}
    duplicados = []
    for r in registros:
        clave = r["usuario_norm"]
        if clave in vistos:
            duplicados.append((vistos[clave]["lightdata_id"], r["lightdata_id"], r["usuario"]))
        vistos[clave] = r
    return duplicados


def _traer_todo(sb, tabla, columnas="*", pagina=1000):
    """Pagina la lectura: Supabase/PostgREST devuelve como máximo 1000 filas por consulta."""
    filas = []
    desde = 0
    while True:
        bloque = sb.table(tabla).select(columnas).range(desde, desde + pagina - 1).execute().data
        filas.extend(bloque)
        if len(bloque) < pagina:
            break
        desde += pagina
    return filas


def sincronizar(sb, registros, dry_run=False):
    print(f"Lightdata: {len(registros)} usuarios en el archivo.")

    duplicados = detectar_duplicados(registros)
    if duplicados:
        print(f"[AVISO] {len(duplicados)} usuario(s) duplicados por 'usuario' normalizado (se importan todos igual, por lightdata_id):")
        for id_a, id_b, usuario in duplicados:
            print(f"   - {usuario!r}: ID {id_a} y ID {id_b}")

    existentes = {} if dry_run else {r["lightdata_id"]: r for r in _traer_todo(sb, "lightdata_usuarios")}

    nuevos, actualizados, sin_cambios = 0, 0, 0
    for r in registros:
        previo = existentes.get(r["lightdata_id"])
        if previo is None:
            nuevos += 1
        elif any(previo.get(k) != v for k, v in r.items() if k not in ("activo_en_ultima_import",)):
            actualizados += 1
        else:
            sin_cambios += 1

    ids_archivo = {r["lightdata_id"] for r in registros}
    desaparecidos = [i for i in existentes if i not in ids_archivo] if existentes else []

    print(f"Resumen: {nuevos} nuevo(s), {actualizados} actualizado(s), {sin_cambios} sin cambios, {len(desaparecidos)} desaparecido(s).")

    if dry_run:
        print("(--dry-run: no se escribio nada en Supabase)")
        return {"nuevos": nuevos, "actualizados": actualizados, "sin_cambios": sin_cambios, "desaparecidos": desaparecidos}

    if registros:
        sb.table("lightdata_usuarios").upsert(registros, on_conflict="lightdata_id").execute()
    if desaparecidos:
        sb.table("lightdata_usuarios").update({"activo_en_ultima_import": False}).in_("lightdata_id", desaparecidos).execute()

    return vincular_choferes(sb, registros)


def vincular_choferes(sb, registros):
    """
    Vincula/crea en choferes_roster a partir de los usuarios con perfil
    "Chofer". Si el lightdata_id ya está vinculado, no hace nada. Si no,
    busca un chofer YA EXISTENTE sin vincular por nombre normalizado
    (trim/minúsculas/sin acentos — nunca por nombre EXACTO, que es la
    causa del choque de hoy) y si hay exactamente uno, lo vincula en vez
    de duplicarlo. Si hay homónimos, lo deja para revisión manual. Si no
    existe ninguno, crea el chofer con pendiente_completar para que se
    termine de cargar vehículo/zona/turno/localidad en el ABM. Ver
    sección 4.3 del .md.
    """
    choferes = _traer_todo(sb, "choferes_roster", "id,nombre,lightdata_id")
    por_lightdata_id = {c["lightdata_id"]: c for c in choferes if c.get("lightdata_id") is not None}

    por_nombre_norm_sin_vincular = {}
    por_nombre_norm_todos = {}
    for c in choferes:
        clave = normalizar(c["nombre"])
        por_nombre_norm_todos.setdefault(clave, []).append(c)
        if c.get("lightdata_id") is None:
            por_nombre_norm_sin_vincular.setdefault(clave, []).append(c)

    creados, vinculados, homonimos = 0, 0, 0
    for r in registros:
        if r["perfil"] != "Chofer" or r["bloqueado"]:
            continue
        if r["lightdata_id"] in por_lightdata_id:
            continue  # ya vinculado, nada que hacer acá

        nombre_completo = f"{r['nombre']} {r['apellido']}".strip()
        candidatos = por_nombre_norm_sin_vincular.get(r["nombre_completo_norm"], [])

        if len(candidatos) == 1:
            sb.table("choferes_roster").update({"lightdata_id": r["lightdata_id"]}).eq("id", candidatos[0]["id"]).execute()
            por_nombre_norm_sin_vincular[r["nombre_completo_norm"]] = []  # ya se usó, no sirve para otro
            vinculados += 1
            continue
        if len(candidatos) > 1 or r["nombre_completo_norm"] in por_nombre_norm_todos:
            # o hay homónimos sin vincular, o el nombre ya está tomado por
            # un chofer vinculado a OTRO lightdata_id (dos personas/registros
            # distintos en Lightdata con el mismo nombre) — en ningún caso
            # hay que insertar, se duplicaría el nombre.
            print(f"[REVISAR] El nombre {nombre_completo!r} (lightdata_id {r['lightdata_id']}) ya existe en choferes_roster vinculado a otro registro o con homónimos: no se creó ni vinculó automáticamente, revisalo a mano en el ABM.")
            homonimos += 1
            continue

        sb.table("choferes_roster").insert({
            "nombre": nombre_completo,
            "lightdata_id": r["lightdata_id"],
            "pendiente_completar": True,
            "activo": True,
        }).execute()
        creados += 1

    print(f"Choferes: {creados} nuevo(s) (pendientes de completar), {vinculados} vinculado(s) a choferes ya existentes, {homonimos} con homónimos (revisión manual).")
    return {"choferes_creados": creados, "choferes_vinculados": vinculados, "choferes_homonimos": homonimos}


def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    live = "--live" in args
    rutas = [a for a in args if not a.startswith("--")]

    if not live and not rutas:
        print("Uso: python sincronizar_lightdata.py --live [--dry-run]")
        print("     python sincronizar_lightdata.py ruta/al/usuarios_lightdata.xlsx [--dry-run]")
        sys.exit(1)

    if live:
        usuario = os.environ.get("LIGHTDATA_USER")
        clave = os.environ.get("LIGHTDATA_PASS")
        if not usuario or not clave:
            sys.exit("Faltan las variables de entorno LIGHTDATA_USER / LIGHTDATA_PASS.")
        print("Lightdata: pidiendo el listado de usuarios en vivo (login por Playwright)...")
        registros = cargar_en_vivo(usuario, clave)
    else:
        registros = cargar_excel(rutas[0])

    if dry_run:
        sincronizar(None, registros, dry_run=True)
        return

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)
    sincronizar(sb, registros)


if __name__ == "__main__":
    main()
