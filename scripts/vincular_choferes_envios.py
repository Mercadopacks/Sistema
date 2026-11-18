"""
vincular_choferes_envios.py
----------------------------
Completa envios.chofer_lightdata_id pegando al endpoint interno de
Lightdata que lista envíos (modules/envios/listado/procesar_listado.php —
ver lightdata_api_envios.md en la raíz del repo). Cada fila trae
`didcadete`, el ID del repartidor asignado — el mismo ID que
lightdata_usuarios.lightdata_id — así que ya no hace falta adivinar el
repartidor por nombre (bug real 2026-11-18, ver reglas_de_negocio.md).

Trae SOLO el día de FECHA_DESCARGA (o el de hoy en ART si no se pasa) y
hace un upsert liviano sobre `envios` actualizando nada más que
chofer_lightdata_id — no toca ningún otro campo del envío.

Uso:
    python vincular_choferes_envios.py [--dry-run]
    FECHA_DESCARGA=2026-11-18 python vincular_choferes_envios.py

Necesita: LIGHTDATA_USER, LIGHTDATA_PASS, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY (entorno o scripts/.env).
"""

import os
import sys
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sincronizar_lightdata import _jquery_param, con_reintentos  # noqa: E402

load_dotenv()

LIGHTDATA_URL = "https://mercadopacks.lightdata.app/"
LIGHTDATA_ENDPOINT_ENVIOS = LIGHTDATA_URL + "modules/envios/listado/procesar_listado.php"
TIMEOUT_MS = 20_000
LOTE = 500

FILTROS_DEFAULT = {
    "asignado": "2", "nombrecliente": "", "codigocliente": "", "nombre": "", "cp": "",
    "estado": "-1", "origen_entrega": "", "logisticaInversa": "2",
    "fecha_desde": "", "fecha_hasta": "", "zonasdeentrega": "", "origen": "",
    "cadete": "", "idml": "", "idml_tipo": "coincidencia",
    "seguimiento_eflet_tipo": "coincidencia", "seguimiento_eflet": "",
    "tracking_number": "", "tracking_number_tipo": "coincidencia",
    "tipo_fecha": "1",  # 1 = Fecha MercadoPacks, mismo criterio que el resto del sistema
    "domicilio": "0", "servicio": "", "andreani_numero": "",
    "obs": "2", "turbo": "", "tipoClientes": 1, "fotos": "2", "deposito": "",
    "cobranzas": "2", "metodo": "",
}

COLUMNAS_DEFAULT = [
    {"id": 0, "CDB": c, "checked": True, "orden": ""}
    for c in ["nombre_fantasia", "ml_vendedor_id", "flexname", "tracking", "fechaventa",
              "fechagestionar", "nombre", "cp", "zona", "namecadete", "estado_envio"]
]


def _fecha_art_hoy():
    return (datetime.now(timezone.utc) + timedelta(hours=-3)).date()


def obtener_envios_del_dia(usuario, clave, fecha_ddmmyyyy):
    """Pagina el endpoint de envíos para un solo día (fecha_desde = fecha_hasta)."""
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

    filas = []
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
            # Ver nota en sincronizar_lightdata.py: el login es por AJAX, ni
            # "networkidle" ni "load" son confiables para saber que ya
            # terminó — se espera un elemento real de la pantalla logueada.
            try:
                page.get_by_role("button", name="OK").click(timeout=5000)
            except PlaywrightTimeoutError:
                pass
            page.get_by_role("link", name="local_shipping Envios").wait_for()

            filtros = {**FILTROS_DEFAULT, "fecha_desde": fecha_ddmmyyyy, "fecha_hasta": fecha_ddmmyyyy}
            pagina = 1
            total_paginas = 1
            while pagina <= total_paginas:
                payload = {
                    "cantxpagina": LOTE, "pagina": pagina, "excel": 0,
                    "filtros": filtros, "columnas": COLUMNAS_DEFAULT,
                    "elim": 0, "historico": False,
                }
                resp = page.request.post(
                    LIGHTDATA_ENDPOINT_ENVIOS,
                    data=_jquery_param(payload),
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                )
                if not resp.ok:
                    raise RuntimeError(f"Lightdata respondió {resp.status} al pedir el listado de envíos.")
                cuerpo = resp.json()
                if not cuerpo.get("estadoLogin", True):
                    raise RuntimeError("Lightdata dice que la sesión no está logueada (estadoLogin=false).")
                rows = cuerpo.get("rows") or []
                # PHP serializa un array no contiguo como OBJETO JSON (claves
                # "500","501",...) en vez de lista — visto real en la página
                # 2 en adelante. Sin esto, .extend(dict) agrega las CLAVES
                # (strings) en vez de las filas.
                if isinstance(rows, dict):
                    rows = list(rows.values())
                filas.extend(rows)
                total_paginas = cuerpo.get("totalPaginas") or 1
                pagina += 1
            return filas
        finally:
            context.close()
            browser.close()


def main():
    dry_run = "--dry-run" in sys.argv[1:]

    usuario = os.environ.get("LIGHTDATA_USER")
    clave = os.environ.get("LIGHTDATA_PASS")
    if not usuario or not clave:
        sys.exit("Faltan las variables de entorno LIGHTDATA_USER / LIGHTDATA_PASS.")

    fecha_descarga = os.environ.get("FECHA_DESCARGA")
    if fecha_descarga:
        fecha = datetime.strptime(fecha_descarga, "%Y-%m-%d").date()
    else:
        fecha = _fecha_art_hoy()
    fecha_ddmmyyyy = fecha.strftime("%d/%m/%Y")

    print(f"Lightdata: pidiendo envíos del {fecha_ddmmyyyy} (login por Playwright)...")
    filas = con_reintentos(lambda: obtener_envios_del_dia(usuario, clave, fecha_ddmmyyyy))
    print(f"{len(filas)} envíos en el día.")

    actualizaciones = []
    sin_cadete = 0
    for fila in filas:
        did = fila.get("did")
        didcadete = fila.get("didcadete")
        if not did:
            continue
        if not didcadete or str(didcadete) == "0":
            sin_cadete += 1
            continue
        actualizaciones.append({
            "id_interno": str(int(float(did))),
            "chofer_lightdata_id": int(float(didcadete)),
        })

    print(f"Con repartidor asignado: {len(actualizaciones)}. Sin asignar: {sin_cadete}.")

    if dry_run:
        print("(--dry-run: no se escribió nada en Supabase)")
        return

    if not actualizaciones:
        print("Nada para actualizar.")
        return

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    # Algunos envíos del día pueden no estar publicados todavía (llegaron
    # después del último ciclo de publicar_supabase.py) — un upsert a
    # ciegas los insertaría incompletos y choca con columnas NOT NULL
    # (bug real 2026-11-18: "raw" no puede ser null). Se filtra a los que
    # YA existen; los que falten se completan solos en el próximo ciclo,
    # una vez que ese envío ya esté publicado.
    todos_los_ids = [a["id_interno"] for a in actualizaciones]
    existentes = set()
    for i in range(0, len(todos_los_ids), LOTE):
        lote_ids = todos_los_ids[i:i + LOTE]
        data = sb.table("envios").select("id_interno").in_("id_interno", lote_ids).execute().data
        existentes.update(r["id_interno"] for r in data)

    actualizaciones = [a for a in actualizaciones if a["id_interno"] in existentes]
    print(f"Ya publicados y listos para vincular: {len(actualizaciones)} (el resto se completa solo en el próximo ciclo).")

    for i in range(0, len(actualizaciones), LOTE):
        lote = actualizaciones[i:i + LOTE]
        # UPDATE real por RPC (ver migración 2026-11-19): un upsert parcial
        # (solo id_interno + chofer_lightdata_id, sin el resto de columnas
        # NOT NULL) le erraba al ON CONFLICT y terminaba intentando
        # INSERTAR una fila incompleta — bug real, no una corrida con
        # suerte. Este RPC hace un UPDATE de verdad, nunca inserta.
        sb.rpc("actualizar_chofer_lightdata_id_lote", {
            "ids": [a["id_interno"] for a in lote],
            "valores": [a["chofer_lightdata_id"] for a in lote],
        }).execute()
        print(f"  actualizados {min(i + LOTE, len(actualizaciones))}/{len(actualizaciones)}")

    print("Listo.")


if __name__ == "__main__":
    main()
