"""
sincronizar_clientes_lightdata.py
------------------------------------
Sincroniza `lightdata_clientes` + `lightdata_cuentas` (ver
docs/lightdata_api_clientes.md). Dos usos:

1. Asociar usuarios tipo "Cliente" del ABM a un cliente real de Lightdata,
   por nombre (pedido 2026-11-20) — solo necesita `lightdata_clientes`.
2. Módulo "Clientes" de Configuración (pedido 2026-11-20, igual que
   Repartidores): muestra los datos del cliente + IDs de sus cuentas
   asociadas (MercadoLibre, Tienda Nube, etc.) — necesita también
   `lightdata_cuentas`.

Dos pasos: `getClientes` (1 sola llamada, todos los clientes habilitados)
y después `getCliente` por cada uno (secuencial, ~0.3-0.5s cada uno,
~297 clientes ≈ 1.5-2.5 min) para las cuentas — ver §1 y §3 del .md.
Nunca se guardan credenciales de las integraciones (`woo_api`, `shop_api`,
etc.), solo los IDs.

Uso:
    python sincronizar_clientes_lightdata.py [--dry-run] [--sin-cuentas]

--sin-cuentas salta el paso de cuentas (solo actualiza lightdata_clientes,
como antes de agregarse esto) — útil si solo hace falta refrescar nombres
rápido.

Necesita: LIGHTDATA_USER, LIGHTDATA_PASS, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY (entorno o scripts/.env).
"""

import os
import sys
import time

from dotenv import load_dotenv
from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sincronizar_lightdata import con_reintentos  # noqa: E402
from vincular_choferes_envios import texto_o_none, entero_o_none  # noqa: E402

load_dotenv()

LIGHTDATA_URL = "https://mercadopacks.lightdata.app/"
LIGHTDATA_ENDPOINT_CLIENTES = LIGHTDATA_URL + "modules/clientes/alta/controlador.php"
TIMEOUT_MS = 20_000
LOTE = 500


def obtener_clientes_en_vivo(usuario, clave):
    """Login por Playwright (mismo flujo que sincronizar_lightdata.py) +
    1 sola llamada a `getClientes` (ver lightdata_api_clientes.md §2.1)."""
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
            try:
                page.get_by_role("button", name="OK").click(timeout=5000)
            except PlaywrightTimeoutError:
                pass
            page.get_by_role("link", name="local_shipping Envios").wait_for()

            resp = page.request.post(
                LIGHTDATA_ENDPOINT_CLIENTES,
                data="operador=getClientes",
                headers={
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
                timeout=60_000,
            )
            if not resp.ok:
                raise RuntimeError(f"Lightdata respondió {resp.status} al pedir getClientes.")
            clientes = resp.json()
            if not isinstance(clientes, list):
                raise RuntimeError("getClientes no devolvió una lista (¿cambió el formato?).")

            cuentas = []
            if "--sin-cuentas" not in sys.argv[1:]:
                dids = [int(float(c["header"]["did"])) for c in clientes if (c.get("header") or {}).get("did")]
                for i, did in enumerate(dids, start=1):
                    resp2 = page.request.post(
                        LIGHTDATA_ENDPOINT_CLIENTES,
                        data=f"operador=getCliente&did={did}",
                        headers={
                            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "X-Requested-With": "XMLHttpRequest",
                        },
                        timeout=60_000,
                    )
                    if not resp2.ok:
                        continue  # un cliente puntual que falla no debe tumbar toda la sincronización
                    detalle = resp2.json()
                    for cuenta in (detalle or {}).get("cuentas") or []:
                        cuentas.append(cuenta)
                    if i % 50 == 0:
                        print(f"  cuentas: consultados {i}/{len(dids)} clientes")

            return clientes, cuentas
        finally:
            context.close()
            browser.close()


ID_EXTERNOS_CUENTA = ["ML_id_vendedor", "tn_id", "tn_url", "shop_url", "woo_web", "vtex_url", "pre_url", "fala_url"]


def _vacio(v):
    return v is None or v == "" or str(v) == "0"


def main():
    dry_run = "--dry-run" in sys.argv[1:]

    usuario = os.environ.get("LIGHTDATA_USER")
    clave = os.environ.get("LIGHTDATA_PASS")
    if not usuario or not clave:
        sys.exit("Faltan LIGHTDATA_USER / LIGHTDATA_PASS.")

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    print("Pidiendo clientes a Lightdata (login por Playwright)...")
    inicio = time.monotonic()
    clientes, cuentas_crudas = con_reintentos(lambda: obtener_clientes_en_vivo(usuario, clave))
    print(f"{len(clientes)} clientes, {len(cuentas_crudas)} cuentas recibidas ({time.monotonic() - inicio:.1f}s).")

    filas = []
    for c in clientes:
        h = c.get("header") or {}
        did = h.get("did")
        if not did:
            continue
        filas.append({
            "did": int(float(did)),
            "codigo": (h.get("codigo") or "").strip() or None,
            "nombre_fantasia": (h.get("nombre_fantasia") or "").strip() or None,
            "razon_social": (h.get("razon_social") or "").strip() or None,
            "habilitado": str(h.get("habilitado")) == "1",
        })

    filas_cuentas = []
    for c in cuentas_crudas:
        if not c.get("did") or not c.get("didCliente"):
            continue
        if not any(not _vacio(c.get(k)) for k in ID_EXTERNOS_CUENTA):
            continue  # cuenta "vacía" (sin ningún ID externo) no sirve para identificar envíos
        filas_cuentas.append({
            "did": int(float(c["did"])),
            "did_cliente": int(float(c["didCliente"])),
            "tipo_cuenta": entero_o_none(c.get("tipoCuenta")),
            "ml_id_vendedor": texto_o_none(c.get("ML_id_vendedor")),
            "ml_user": texto_o_none(c.get("ML_user")),
            "tn_id": texto_o_none(c.get("tn_id")),
            "tn_url": texto_o_none(c.get("tn_url")),
            "shop_url": texto_o_none(c.get("shop_url")),
            "woo_web": texto_o_none(c.get("woo_web")),
            "vtex_url": texto_o_none(c.get("vtex_url")),
            "vtex_idlogistica": texto_o_none(c.get("vtex_idlogistica")),
            "pre_url": texto_o_none(c.get("pre_url")),
            "fala_url": texto_o_none(c.get("fala_url")),
        })

    if dry_run:
        print(f"(--dry-run: {len(filas)} clientes, {len(filas_cuentas)} cuentas con ID, no se escribió nada en Supabase)")
        for f in filas[:10]:
            print(" ", f)
        for f in filas_cuentas[:10]:
            print(" ", f)
        return

    for i in range(0, len(filas), LOTE):
        lote = filas[i:i + LOTE]
        sb.table("lightdata_clientes").upsert(lote, on_conflict="did").execute()
        print(f"  clientes subidos {min(i + LOTE, len(filas))}/{len(filas)}")

    for i in range(0, len(filas_cuentas), LOTE):
        lote = filas_cuentas[i:i + LOTE]
        sb.table("lightdata_cuentas").upsert(lote, on_conflict="did").execute()
        print(f"  cuentas subidas {min(i + LOTE, len(filas_cuentas))}/{len(filas_cuentas)}")

    print("Listo.")


if __name__ == "__main__":
    main()
