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
- `estado`: el campo `estado_envio` de esa misma fila — el estado REAL del
  envío (mismo vocabulario que la columna "Estado" del Excel de
  publicar_supabase.py: "Entregado", "No entregado", "Devuelto al
  cliente", "A retirar", etc., ver lightdata_api_envios.md §4.1). Bug real
  2026-11-19 (parte 1): ya se pedía esta columna al endpoint pero nunca se
  guardaba, así que `envios.estado` solo se refrescaba una vez por
  publicación de Excel en vez de cada 10 min como el resto de este
  script — un envío podía figurar "No Entregado" en Fallidos durante
  horas después de que Lightdata ya lo marcara "Entregado"/"Devuelto al
  cliente". Bug real 2026-11-19 (parte 2, detectado el mismo día al
  revisar el fix anterior): este endpoint devuelve `estado_envio` como
  CÓDIGO NUMÉRICO (ver CODIGOS_ESTADO más abajo), no como texto — se
  guardaba el número crudo, pisando el texto correcto y rompiendo
  cualquier comparación contra el estado (incluida la exclusión de "A
  retirar" en Fallidos). Se traduce con `texto_estado()`.

Trae un RANGO de días (hoy en ART hacia atrás, RANGO_DIAS_LIVE días, default
3) o el día puntual de FECHA_DESCARGA si se pasa, y actualiza nada más que
esas 5 columnas, en un solo RPC por lote — no toca ningún otro campo del
envío.

Bug real 2026-11-19 (parte 3): hasta ahora este script solo traía el día
de HOY, así que un envío dejaba de refrescarse en vivo apenas pasaba la
medianoche (ART) — un caso de Fallidos que lleva 2+ días abierto quedaba
con el `estado` congelado para siempre en lo que decía el último Excel del
día que se generó, aunque Lightdata ya lo hubiera actualizado (caso real:
tracking 48553756312, 2 días de antigüedad, estado real "Cancelado" en
Lightdata pero el sistema seguía mostrando el estado viejo). Se amplía la
consulta a un rango de `RANGO_DIAS_LIVE` días hacia atrás.

**`RANGO_DIAS_LIVE=3` NO es arbitrario, está medido**: se probó en vivo
contra Lightdata (dry-run real, no un test sintético) con 3/5/7 días.
3 días: ~23s, 7.388 filas, anduvo bien. 5 y 7 días: colgado más de 8
minutos sin responder ni tirar error — NO es un problema de nuestro
timeout (se probó subiéndolo a 60s en `_pedir_todas_las_paginas` y pasó
igual), el propio endpoint de Lightdata se degrada de forma no lineal
pasado cierto rango de fechas (asumible: una consulta sin índice
adecuado del lado de ellos para rangos amplios). Por eso el default queda
en 3 días — cubre el umbral "pedir" completo (2 días,
`parametros_alertas_fallidos`) y casi todo "prioridad" (3 días), pero NO
"revisar" (5 días): un caso que llega a ese umbral sin resolverse deja de
refrescarse en vivo igual. Si hace falta cubrir ese caso, la solución NO
es subir este número (ya probado que rompe) — ver `qa_fallidos_estado.md`,
sección "Alcance no cubierto", para la alternativa (consulta dirigida por
tracking en vez de barrido por fecha).

Uso:
    python vincular_choferes_envios.py [--dry-run]
    FECHA_DESCARGA=2026-11-18 python vincular_choferes_envios.py
    RANGO_DIAS_LIVE=5 python vincular_choferes_envios.py  # NO USAR en el cron: colgado y probado, ver arriba

Necesita: LIGHTDATA_USER, LIGHTDATA_PASS, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY (entorno o scripts/.env).
"""

import os
import sys
import time
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

# `estado_envio` en este endpoint viene como CÓDIGO NUMÉRICO, no como texto
# (bug real 2026-11-19: se guardaba el código crudo en envios.estado,
# pisando el texto correcto — ej. "7" en vez de "A retirar" — lo que a su
# vez rompía cualquier comparación de texto contra ese estado, incluida la
# exclusión de "A retirar" en Fallidos). Tabla de códigos verificada en
# lightdata_api_envios.md §4.1; para los que también aparecen en
# parametros_fallidos_mapeo (migración 2026-11-16_fallidos_cambios.sql) se
# usa esa misma grafía exacta porque es la que matchea con la
# configuración real, aunque no sea 100% consistente entre sí (ej. "Nadie
# 2da visita" en minúscula vs "Entregado 2DA visita" en mayúscula — así
# está en los datos reales, no es un error de tipeo).
CODIGOS_ESTADO = {
    0: "Retirado",
    1: "En planta de procesamiento",
    2: "En camino al destinatario",
    3: "Devolviendo a planta de procesamiento",
    5: "Entregado",
    6: "Nadie",
    7: "A retirar",
    8: "Cancelado",
    9: "Entregado 2DA visita",
    10: "Nadie 2da visita",
    11: "En camino 2da visita",
    12: "En camino reprogramado",
    13: "No entregado",
    14: "Devuelto al cliente",
    15: "Rechazado por el comprador",
    22: "Dirección incorrecta",
    30: "Reprogramado por comprador",
    31: "Reprogramado por meli",
}


def texto_o_none(valor):
    if valor is None:
        return None
    texto = str(valor).strip()
    return texto or None


def texto_estado(valor):
    """Como texto_o_none, pero traduce el código numérico de estado_envio
    a su nombre real (ver CODIGOS_ESTADO). Si ya viene como texto (o un
    código no mapeado), lo deja tal cual en vez de perderlo."""
    texto = texto_o_none(valor)
    if texto is None:
        return None
    try:
        codigo = int(float(texto))
    except ValueError:
        return texto
    return CODIGOS_ESTADO.get(codigo, texto)


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
        # `page.set_default_timeout` NO aplica a `page.request.*` (es un
        # timeout de navegación/acciones de la página, el API request
        # context tiene el suyo propio, 30s por defecto) — bug real
        # 2026-11-19 encontrado al probar rangos de varios días: una página
        # con más filas (por el rango más amplio) tardaba más de 30s en
        # bajar y el request timeouteaba igual aunque TIMEOUT_MS=20_000
        # pareciera decir otra cosa. Se pasa explícito acá, más alto que
        # antes porque ahora las páginas pueden traer más filas.
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


def obtener_envios_del_rango(usuario, clave, fecha_desde_ddmmyyyy, fecha_hasta_ddmmyyyy):
    """
    Pagina el endpoint de envíos para un rango de fechas (fecha_desde puede
    ser distinto de fecha_hasta — ver bug real 2026-11-19 parte 3 en el
    docstring del módulo: antes era siempre un solo día, lo que dejaba sin
    refrescar el estado de cualquier caso de Fallidos con más de un día de
    antigüedad). Devuelve (filas_todas, dids_con_logistica_inversa_real) —
    la segunda consulta (mismo login, filtros.logisticaInversa="1") es la
    única forma confiable de saber si un envío tiene logística inversa de
    verdad, ver docstring del módulo.
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

            filtros_todos = {**FILTROS_DEFAULT, "fecha_desde": fecha_desde_ddmmyyyy, "fecha_hasta": fecha_hasta_ddmmyyyy, "logisticaInversa": "2"}
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
        # Día puntual (uso manual/backfill) — desde = hasta, igual que antes.
        fecha_hasta = datetime.strptime(fecha_descarga, "%Y-%m-%d").date()
        fecha_desde = fecha_hasta
    else:
        fecha_hasta = _fecha_art_hoy()
        rango_dias = int(os.environ.get("RANGO_DIAS_LIVE", "3"))
        fecha_desde = fecha_hasta - timedelta(days=rango_dias - 1)
    fecha_desde_ddmmyyyy = fecha_desde.strftime("%d/%m/%Y")
    fecha_hasta_ddmmyyyy = fecha_hasta.strftime("%d/%m/%Y")

    print(f"Lightdata: pidiendo envíos del {fecha_desde_ddmmyyyy} al {fecha_hasta_ddmmyyyy} (login por Playwright)...")
    inicio = time.monotonic()
    filas, dids_con_logistica = con_reintentos(
        lambda: obtener_envios_del_rango(usuario, clave, fecha_desde_ddmmyyyy, fecha_hasta_ddmmyyyy)
    )
    print(f"{len(filas)} envíos en el rango. {len(dids_con_logistica)} con logística inversa real (Lightdata). "
          f"({time.monotonic() - inicio:.1f}s pidiendo a Lightdata)")

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
            "estado": texto_estado(fila.get("estado_envio")),
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
