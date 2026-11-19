"""
vincular_choferes_envios.py
----------------------------
Completa 4 columnas de `envios` pegando al endpoint interno de Lightdata
que lista envíos (modules/envios/listado/procesar_listado.php — ver
lightdata_api_envios.md en la raíz del repo). Ninguna de las 4 está
disponible en el Excel que descarga publicar_supabase.py.

- `chofer_lightdata_id`: cada fila trae `didcadete`, el ID del repartidor
  asignado — el mismo ID que lightdata_usuarios.lightdata_id — así que ya
  no hace falta adivinar el repartidor por nombre (bug real 2026-11-18).
- `logistica_inversa_real`: el filtro `filtros.logisticaInversa` del
  endpoint (0=No/1=Sí/2=Todos) es un flag confiable de Lightdata, pero NO
  se puede pedir como columna de la respuesta — solo sirve como filtro.
  Se resuelve haciendo una segunda consulta filtrada por 1=Sí para el
  mismo día y cruzando los `did` (bug real 2026-11-19: antes se parseaba
  el texto libre de `Logistica Inversa`, que trae literalmente "No" en
  más de 100 casos y los contaba como Cambio por error — ver
  reglas_de_negocio.md).
- `estado_ml` / `did_cliente`: campos `estadoml`/`didCliente` de la misma
  fila de la consulta "todos" — no cuestan una consulta extra, ya vienen
  en la respuesta, solo faltaba guardarlos (pedido 2026-11-19).

Trae SOLO el día de FECHA_DESCARGA (o el de hoy en ART si no se pasa) y
actualiza nada más que esas 4 columnas, en un solo RPC por lote — no toca
ningún otro campo del envío.

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


def texto_o_none(valor):
    if valor is None:
        return None
    texto = str(valor).strip()
    return texto or None


def entero_o_none(valor):
    if valor is None or str(valor).strip() in ("", "0"):
        return None
    try:
        return int(float(valor))
    except (TypeError, ValueError):
        return None


def _fecha_art_hoy():
    return (datetime.now(timezone.utc) + timedelta(hours=-3)).date()


def _pedir_todas_las_paginas(page, filtros):
    filas = []
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


def obtener_envios_del_dia(usuario, clave, fecha_ddmmyyyy):
    """
    Pagina el endpoint de envíos para un solo día (fecha_desde = fecha_hasta).
    Devuelve (filas_todas, dids_con_logistica_inversa_real) — la segunda
    consulta (mismo login, filtros.logisticaInversa="1") es la única forma
    confiable de saber si un envío tiene logística inversa de verdad, ver
    docstring del módulo.
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
            # Ver nota en sincronizar_lightdata.py: el login es por AJAX, ni
            # "networkidle" ni "load" son confiables para saber que ya
            # terminó — se espera un elemento real de la pantalla logueada.
            try:
                page.get_by_role("button", name="OK").click(timeout=5000)
            except PlaywrightTimeoutError:
                pass
            page.get_by_role("link", name="local_shipping Envios").wait_for()

            filtros_todos = {**FILTROS_DEFAULT, "fecha_desde": fecha_ddmmyyyy, "fecha_hasta": fecha_ddmmyyyy, "logisticaInversa": "2"}
            filas = _pedir_todas_las_paginas(page, filtros_todos)

            filtros_logistica = {**filtros_todos, "logisticaInversa": "1"}
            filas_con_logistica = _pedir_todas_las_paginas(page, filtros_logistica)
            dids_con_logistica = {str(int(float(f["did"]))) for f in filas_con_logistica if f.get("did")}

            return filas, dids_con_logistica
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
    filas, dids_con_logistica = con_reintentos(lambda: obtener_envios_del_dia(usuario, clave, fecha_ddmmyyyy))
    print(f"{len(filas)} envíos en el día. {len(dids_con_logistica)} con logística inversa real (Lightdata).")

    actualizaciones = []
    sin_cadete = 0
    con_cadete = 0
    for fila in filas:
        did = fila.get("did")
        if not did:
            continue
        id_interno = str(int(float(did)))

        fila_actualizada = {
            "id_interno": id_interno,
            "logistica_inversa_real": id_interno in dids_con_logistica,
            "estado_ml": texto_o_none(fila.get("estadoml")),
            "did_cliente": entero_o_none(fila.get("didCliente")),
        }

        didcadete = fila.get("didcadete")
        if not didcadete or str(didcadete) == "0":
            sin_cadete += 1
        else:
            fila_actualizada["chofer_lightdata_id"] = int(float(didcadete))
            con_cadete += 1

        actualizaciones.append(fila_actualizada)

    print(f"Con repartidor asignado: {con_cadete}. Sin asignar: {sin_cadete}.")

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
    # después del último ciclo de publicar_supabase.py) — un update a
    # ciegas no rompe nada (un UPDATE sobre un id_interno que no existe
    # simplemente no afecta ninguna fila), pero no tiene sentido mandarlo:
    # se filtra a los que YA existen y se reporta cuántos quedaron para el
    # próximo ciclo.
    todos_los_ids = [a["id_interno"] for a in actualizaciones]
    existentes = set()
    for i in range(0, len(todos_los_ids), LOTE):
        lote_ids = todos_los_ids[i:i + LOTE]
        data = sb.table("envios").select("id_interno").in_("id_interno", lote_ids).execute().data
        existentes.update(r["id_interno"] for r in data)

    actualizaciones = [a for a in actualizaciones if a["id_interno"] in existentes]
    print(f"Ya publicados y listos para actualizar: {len(actualizaciones)}/{len(todos_los_ids)} (el resto se completa solo en el próximo ciclo).")

    # UPDATE real por RPC jsonb (ver migración 2026-11-19): un upsert
    # parcial (solo algunas columnas, sin el resto de columnas NOT NULL)
    # le erraba al ON CONFLICT y terminaba intentando INSERTAR una fila
    # incompleta — bug real, no una corrida con suerte. Este RPC hace un
    # UPDATE de verdad, nunca inserta, y actualiza las 4 columnas en un
    # solo viaje por lote (antes eran 2 RPC separados).
    for i in range(0, len(actualizaciones), LOTE):
        lote = actualizaciones[i:i + LOTE]
        sb.rpc("actualizar_envio_lightdata_vivo_lote", {"filas": lote}).execute()
        print(f"  actualizados {min(i + LOTE, len(actualizaciones))}/{len(actualizaciones)}")

    print("Listo.")


if __name__ == "__main__":
    main()
