"""
qa_validar_estado_vivo.py
--------------------------
Test de regresión para la clase de bug del 2026-11-19 (ver
reglas_de_negocio.md, changelog): `envios.estado` desincronizado de
Lightdata, o guardado como código numérico crudo en vez de texto.

Compara, para una MUESTRA real de envíos (los mismos que trae
vincular_choferes_envios.py en su rango de RANGO_DIAS_LIVE días), lo que
Lightdata dice AHORA MISMO (`estado_envio` ya traducido por
`texto_estado()`) contra lo que hay guardado en `envios.estado` en
Supabase. No escribe nada — es de solo lectura, para correr a mano o en
CI antes de dar por buena una corrida.

Qué detecta (y por qué, caso real que motivó cada chequeo):
  1. `estado` guardado como puro número (ej. "7") — bug del
     2026-11-19 parte 2, estado_envio es un código, no texto.
  2. Cualquier envío de la muestra cuyo `estado` en Supabase NO coincide
     con el texto que Lightdata dice ahora — señal de que el refresco en
     vivo no está llegando a ese envío (bug del 2026-11-19 parte 1 y 3:
     o no se guardaba, o solo cubría el día de hoy).
  3. Envíos con `estado = 'A retirar'` que además están en
     `parametros_fallidos_mapeo` — si alguno aparece, señal de que el
     mapeo de códigos/textos se desvió del valor real "A retirar" (ver
     parte 2) y por lo tanto el filtro de exclusión en el frontend
     (`cargarFallidos()`) no lo va a atrapar porque compara por string
     exacto.

Uso:
    python qa_validar_estado_vivo.py [--rango-dias N]

Necesita: LIGHTDATA_USER, LIGHTDATA_PASS, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY (entorno o scripts/.env). Es de solo lectura
en ambos lados — seguro de correr en cualquier momento.
"""

import os
import re
import sys
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ingesta_lightdata"))
from vincular_choferes_envios import (  # noqa: E402
    obtener_envios_del_rango, texto_estado, CODIGOS_ESTADO,
)
from sincronizar_lightdata import con_reintentos  # noqa: E402

load_dotenv()

LOTE = 500


def _fecha_art_hoy():
    return (datetime.now(timezone.utc) + timedelta(hours=-3)).date()


def main():
    rango_dias = 3  # mismo default que RANGO_DIAS_LIVE en vincular_choferes_envios.py
    if "--rango-dias" in sys.argv:
        rango_dias = int(sys.argv[sys.argv.index("--rango-dias") + 1])

    usuario = os.environ.get("LIGHTDATA_USER")
    clave = os.environ.get("LIGHTDATA_PASS")
    if not usuario or not clave:
        sys.exit("Faltan LIGHTDATA_USER / LIGHTDATA_PASS.")

    hoy = _fecha_art_hoy()
    desde = hoy - timedelta(days=rango_dias - 1)
    print(f"Pidiendo a Lightdata el rango {desde.strftime('%d/%m/%Y')} - {hoy.strftime('%d/%m/%Y')}...")
    filas, _ = con_reintentos(
        lambda: obtener_envios_del_rango(usuario, clave, desde.strftime("%d/%m/%Y"), hoy.strftime("%d/%m/%Y"))
    )
    print(f"{len(filas)} envíos traídos de Lightdata.\n")

    esperado_por_id = {}
    for fila in filas:
        did = fila.get("did")
        if not did:
            continue
        id_interno = str(int(float(did)))
        esperado_por_id[id_interno] = texto_estado(fila.get("estado_envio"))

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    ids = list(esperado_por_id.keys())
    reales_por_id = {}
    for i in range(0, len(ids), LOTE):
        lote_ids = ids[i:i + LOTE]
        data = sb.table("envios").select("id_interno,tracking,estado").in_("id_interno", lote_ids).execute().data
        for r in data:
            reales_por_id[r["id_interno"]] = r

    # --- Chequeo 1: estado guardado como código numérico crudo ---
    numericos = [r for r in reales_por_id.values() if r["estado"] is not None and re.fullmatch(r"\d+", r["estado"])]
    print(f"[1] Envíos con `estado` guardado como número crudo: {len(numericos)}")
    for r in numericos[:20]:
        print(f"    id_interno={r['id_interno']} tracking={r['tracking']} estado='{r['estado']}'"
              f" (código {CODIGOS_ESTADO.get(int(r['estado']), '???')})")

    # --- Chequeo 2: estado desincronizado vs Lightdata ahora mismo ---
    desincronizados = []
    for id_interno, esperado in esperado_por_id.items():
        real = reales_por_id.get(id_interno)
        if real is None:
            continue  # no publicado todavía, no es un error
        if esperado is not None and real["estado"] != esperado:
            desincronizados.append((real, esperado))
    print(f"\n[2] Envíos con `estado` desincronizado de Lightdata: {len(desincronizados)}")
    for real, esperado in desincronizados[:20]:
        print(f"    id_interno={real['id_interno']} tracking={real['tracking']}"
              f" db='{real['estado']}' lightdata='{esperado}'")

    # --- Chequeo 3: "A retirar" que además está en parametros_fallidos_mapeo ---
    mapeo = sb.table("parametros_fallidos_mapeo").select("estado").execute().data
    estados_mapeo = {m["estado"] for m in mapeo}
    if "A retirar" in estados_mapeo:
        print("\n[3] ALERTA: 'A retirar' está en parametros_fallidos_mapeo — el filtro del"
              " frontend lo excluye igual (es defensivo, no depende de esta tabla), pero"
              " convendría sacarlo de la configuración para que quede prolijo.")
    else:
        print("\n[3] OK: 'A retirar' no está en parametros_fallidos_mapeo.")

    print("\n--- Resultado ---")
    fallo = bool(numericos) or bool(desincronizados)
    print("FALLÓ" if fallo else "OK")
    sys.exit(1 if fallo else 0)


if __name__ == "__main__":
    main()
