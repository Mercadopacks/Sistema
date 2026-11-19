"""
backfill_estado_fallidos_viejos.py
------------------------------------
Corrida ÚNICA (no es parte del cron) para ponerse al día con los casos de
Fallidos y Cambios que quedaron con `envios.estado` desactualizado por la
cadena de bugs del 2026-11-19 (ver reglas_de_negocio.md, changelog) — en
particular, todo lo que tiene más de los 3 días que cubre el refresco en
vivo normal (`vincular_choferes_envios.py`, `RANGO_DIAS_LIVE`).

Por qué NO es un barrido por fecha: ya se midió que pedirle a Lightdata un
rango de varios días (5-7+) cuelga el endpoint (ver docstring de
`vincular_choferes_envios.py` y `qa_fallidos_estado.md`, sección "Alcance
no cubierto"). En vez de eso, esto arma la lista de candidatos DESDE
NUESTRA PROPIA BASE (los que hoy están en `parametros_fallidos_mapeo` o
tienen `logistica_inversa_real=true` — el mismo criterio que usa
`cargarFallidos()` en el frontend, sección 1 de index.html) y le pregunta
a Lightdata, uno por uno, por su `tracking_number` puntual — una consulta
chica y rápida en vez de una consulta grande y lenta.

Uso:
    python backfill_estado_fallidos_viejos.py [--dry-run]

Necesita: LIGHTDATA_USER, LIGHTDATA_PASS, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY (entorno o scripts/.env).
"""

import os
import sys
import time

from dotenv import load_dotenv
from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vincular_choferes_envios import (  # noqa: E402
    FILTROS_DEFAULT, COLUMNAS_DEFAULT, LIGHTDATA_URL, LIGHTDATA_ENDPOINT_ENVIOS,
    TIMEOUT_MS, texto_estado, texto_o_none, entero_o_none,
)
from sincronizar_lightdata import _jquery_param, con_reintentos  # noqa: E402

load_dotenv()

LOTE_RPC = 500


def obtener_candidatos(sb):
    mapeo = sb.table("parametros_fallidos_mapeo").select("estado").execute().data
    estados = [m["estado"] for m in mapeo if m["estado"] != "A retirar"]

    por_estado = sb.table("envios").select("id_interno,tracking").in_("estado", estados).execute().data
    por_logistica = sb.table("envios").select("id_interno,tracking").eq("logistica_inversa_real", True).execute().data

    seg_pendientes = sb.table("fallidos_seguimiento").select("id_interno").eq("estatus", "pendiente").execute().data
    ids_seguimiento = {s["id_interno"] for s in seg_pendientes}
    por_seguimiento = []
    if ids_seguimiento:
        por_seguimiento = sb.table("envios").select("id_interno,tracking").in_("id_interno", list(ids_seguimiento)).execute().data

    candidatos = {}
    for fila in por_estado + por_logistica + por_seguimiento:
        if fila.get("tracking"):
            candidatos[fila["id_interno"]] = fila["tracking"]
    return candidatos


def consultar_tracking(page, tracking):
    """Dos consultas chicas y puntuales (no un barrido): una para traer la
    fila, otra para saber si tiene logística inversa real (ver docstring
    de vincular_choferes_envios.py — ese flag no se puede pedir como
    columna, solo como filtro)."""
    filtros = {**FILTROS_DEFAULT, "tracking_number": tracking, "logisticaInversa": "2"}
    payload = {
        "cantxpagina": 10, "pagina": 1, "excel": 0,
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
        timeout=60_000,
    )
    if not resp.ok:
        raise RuntimeError(f"Lightdata respondió {resp.status} para tracking {tracking}.")
    cuerpo = resp.json()
    if not cuerpo.get("estadoLogin", True):
        raise RuntimeError("Lightdata dice que la sesión no está logueada (estadoLogin=false).")
    filas = cuerpo.get("rows") or []
    if isinstance(filas, dict):
        filas = list(filas.values())
    if not filas:
        return None

    filtros_logistica = {**filtros, "logisticaInversa": "1"}
    payload_logistica = {**payload, "filtros": filtros_logistica}
    resp2 = page.request.post(
        LIGHTDATA_ENDPOINT_ENVIOS,
        data=_jquery_param(payload_logistica),
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=60_000,
    )
    cuerpo2 = resp2.json() if resp2.ok else {"rows": []}
    filas2 = cuerpo2.get("rows") or []
    if isinstance(filas2, dict):
        filas2 = list(filas2.values())

    return filas[0], bool(filas2)


def main():
    dry_run = "--dry-run" in sys.argv[1:]

    usuario = os.environ.get("LIGHTDATA_USER")
    clave = os.environ.get("LIGHTDATA_PASS")
    if not usuario or not clave:
        sys.exit("Faltan LIGHTDATA_USER / LIGHTDATA_PASS.")

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    candidatos = obtener_candidatos(sb)
    print(f"{len(candidatos)} envíos candidatos (estado en parametros_fallidos_mapeo,"
          f" logistica_inversa_real=true, o con caso pendiente en fallidos_seguimiento).")

    if not candidatos:
        print("Nada para actualizar.")
        return

    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

    def hacer_login_y_consultar():
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
                try:
                    page.get_by_role("button", name="OK").click(timeout=5000)
                except PlaywrightTimeoutError:
                    pass
                page.get_by_role("link", name="local_shipping Envios").wait_for()

                actualizaciones = []
                no_encontrados = []
                for i, (id_interno, tracking) in enumerate(candidatos.items(), start=1):
                    resultado = consultar_tracking(page, tracking)
                    if resultado is None:
                        no_encontrados.append(tracking)
                        continue
                    fila, tiene_logistica = resultado
                    actualizacion = {
                        "id_interno": id_interno,
                        "logistica_inversa_real": tiene_logistica,
                        "estado": texto_estado(fila.get("estado_envio")),
                        "estado_ml": texto_o_none(fila.get("estadoml")),
                        "did_cliente": entero_o_none(fila.get("didCliente")),
                    }
                    didcadete = fila.get("didcadete")
                    if didcadete and str(didcadete) != "0":
                        actualizacion["chofer_lightdata_id"] = int(float(didcadete))
                    actualizaciones.append(actualizacion)
                    if i % 25 == 0:
                        print(f"  consultados {i}/{len(candidatos)}")
                return actualizaciones, no_encontrados
            finally:
                context.close()
                browser.close()

    print("Consultando Lightdata, un tracking a la vez (puede tardar varios minutos)...")
    inicio = time.monotonic()
    actualizaciones, no_encontrados = con_reintentos(hacer_login_y_consultar)
    print(f"Listo en {time.monotonic() - inicio:.1f}s. {len(actualizaciones)} actualizaciones,"
          f" {len(no_encontrados)} no encontrados en Lightdata (de baja/eliminados, probablemente).")
    if no_encontrados:
        print("  No encontrados:", ", ".join(no_encontrados[:20]))

    if dry_run:
        print("(--dry-run: no se escribió nada en Supabase)")
        for a in actualizaciones[:20]:
            print(" ", a)
        return

    if not actualizaciones:
        print("Nada para actualizar.")
        return

    for i in range(0, len(actualizaciones), LOTE_RPC):
        lote = actualizaciones[i:i + LOTE_RPC]
        sb.rpc("actualizar_envio_lightdata_vivo_lote", {"filas": lote}).execute()
        print(f"  actualizados {min(i + LOTE_RPC, len(actualizaciones))}/{len(actualizaciones)}")

    print("Listo.")


if __name__ == "__main__":
    main()
