"""
backfill_chofer_lightdata_id.py
---------------------------------
Migración de una sola vez (ver reglas_de_negocio.md, changelog 2026-11-19):
completa envios.chofer_lightdata_id para los envíos que ya existían antes
de vincular_choferes_envios.py (que solo cubre el día en curso desde que
se activó). Acá, a falta de didcadete real (no se puede re-pedir a
Lightdata el histórico completo de forma práctica), se resuelve por
NOMBRE NORMALIZADO contra lightdata_usuarios — mismo criterio y mismo
riesgo de homónimos que sincronizar_lightdata.py, documentado ahí.

De acá en adelante, los envíos NUEVOS siempre se vinculan por ID real
(vincular_choferes_envios.py) — este script es solo para completar el
pasado, se corre una vez y no hace falta repetirlo salvo que se detecten
muchos envíos viejos sin vincular todavía.

Uso:
    python backfill_chofer_lightdata_id.py [--dry-run]

Necesita: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (entorno o scripts/.env).
"""

import os
import re
import sys
import unicodedata

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

LOTE = 500


def normalizar(texto):
    if texto is None:
        return ""
    texto = str(texto).strip().lower()
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = re.sub(r"[^a-z0-9\s]", "", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto


def traer_todo(sb, tabla, columnas, filtro=None):
    filas = []
    desde = 0
    while True:
        q = sb.table(tabla).select(columnas).range(desde, desde + 999)
        if filtro:
            q = filtro(q)
        bloque = q.execute().data
        filas.extend(bloque)
        if len(bloque) < 1000:
            break
        desde += 1000
    return filas


def main():
    dry_run = "--dry-run" in sys.argv[1:]

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    print("Cargando lightdata_usuarios...")
    usuarios = traer_todo(sb, "lightdata_usuarios", "lightdata_id,nombre_completo_norm,bloqueado")
    por_nombre = {}
    duplicados_nombre = set()
    for u in usuarios:
        clave = u["nombre_completo_norm"]
        if not clave:
            continue
        if clave in por_nombre and por_nombre[clave] != u["lightdata_id"]:
            duplicados_nombre.add(clave)
        por_nombre[clave] = u["lightdata_id"]
    print(f"{len(usuarios)} usuarios de Lightdata, {len(por_nombre)} nombres normalizados únicos, {len(duplicados_nombre)} con homónimos (no se resuelven acá, quedan sin vincular).")

    print("Buscando envíos sin chofer_lightdata_id y con cadete cargado...")
    envios = traer_todo(
        sb, "envios", "id_interno,cadete",
        lambda q: q.is_("chofer_lightdata_id", "null").not_.is_("cadete", "null"),
    )
    print(f"{len(envios)} envíos para resolver.")

    actualizaciones = []
    sin_match = 0
    homonimos = 0
    for e in envios:
        clave = normalizar(e["cadete"])
        if not clave:
            continue
        if clave in duplicados_nombre:
            homonimos += 1
            continue
        lightdata_id = por_nombre.get(clave)
        if lightdata_id is None:
            sin_match += 1
            continue
        actualizaciones.append({"id_interno": e["id_interno"], "chofer_lightdata_id": lightdata_id})

    print(f"Resueltos por nombre: {len(actualizaciones)}. Sin match en lightdata_usuarios: {sin_match}. Con homónimos (ambiguo, no se tocan): {homonimos}.")

    if dry_run:
        print("(--dry-run: no se escribió nada en Supabase)")
        return

    if not actualizaciones:
        print("Nada para actualizar.")
        return

    # Mismo resguardo que vincular_choferes_envios.py: entre el select de
    # arriba y el upsert puede pasar un rato largo (22k filas), y en el
    # medio el pipeline en vivo sigue corriendo — si un id_interno deja de
    # existir en ese lapso, un upsert a ciegas lo insertaría incompleto
    # (choca con NOT NULL en "raw"). Se re-verifica justo antes de escribir.
    todos_los_ids = [a["id_interno"] for a in actualizaciones]
    existentes = set()
    for i in range(0, len(todos_los_ids), LOTE):
        lote_ids = todos_los_ids[i:i + LOTE]
        data = sb.table("envios").select("id_interno").in_("id_interno", lote_ids).execute().data
        existentes.update(r["id_interno"] for r in data)
    descartados = len(actualizaciones) - len(existentes)
    if descartados:
        print(f"[AVISO] {descartados} id(s) ya no existían al momento de escribir (se descartan, no es grave).")
    actualizaciones = [a for a in actualizaciones if a["id_interno"] in existentes]

    for i in range(0, len(actualizaciones), LOTE):
        lote = actualizaciones[i:i + LOTE]
        # UPDATE real por RPC (ver migración 2026-11-19) — el upsert parcial
        # fallaba siempre contra "envios" (ON CONFLICT no se resolvía como
        # UPDATE con un payload de 2 columnas), ver el RPC para el detalle.
        sb.rpc("actualizar_chofer_lightdata_id_lote", {
            "ids": [a["id_interno"] for a in lote],
            "valores": [a["chofer_lightdata_id"] for a in lote],
        }).execute()
        print(f"  actualizados {min(i + LOTE, len(actualizaciones))}/{len(actualizaciones)}")

    print("Listo.")


if __name__ == "__main__":
    main()
