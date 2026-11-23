"""
importar_mapeo_zonas.py
------------------------------------
Importa la hoja "Base_Zonas" del archivo "1. Informacion Base
Repartidores.xlsx" (columnas LOCALIDAD, PROVINCIA, CP, ZONA) a
`parametros_localidad_cps`, traduciendo el esquema viejo (CABA/ZONA 1/ZONA
2/ZONA 3) al ABM de Cordones ya existente (CABA/GBA1/GBA2/GBA3).

Pedido explícito del usuario (2026-11-23): solo se migran las filas que YA
tienen una zona asignada — el resto (~3.135 de 4.786) son filas vacías que
Base_Zonas arrastra por el desplegable de Google Sheets, no datos reales.

Uso:
    python importar_mapeo_zonas.py "C:\\ruta\\1. Informacion Base Repartidores.xlsx" [--dry-run]

Necesita SUPABASE_DB_URL en el entorno (o scripts/.env).
"""

import argparse
import sys
import unicodedata

from dotenv import load_dotenv

load_dotenv()

MAPA_CORDON = {
    "CABA": "CABA",
    "ZONA 1": "GBA1",
    "ZONA 2": "GBA2",
    "ZONA 3": "GBA3",
}


def normalizar(valor):
    if valor is None:
        return ""
    s = unicodedata.normalize("NFD", str(valor).strip())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.upper()


import re


def normalizar_cp(valor):
    # Mismo criterio que normalizar_cp_localidad() en SQL (puerto de
    # limpiarCP() de Codigo Liquidacion repartidores.txt): una corrida de 4
    # dígitos si existe, si no cualquier dígito suelto que haya.
    if valor is None:
        return None
    s = str(valor).strip()
    if s.endswith(".0") and s[:-2].replace(".", "", 1).isdigit():
        s = s[:-2]
    match = re.search(r"\d{4}", s)
    if match:
        return match.group(0)
    digits = re.sub(r"\D", "", s)
    return digits or None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archivo")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    import openpyxl

    wb = openpyxl.load_workbook(args.archivo, read_only=True, data_only=True)
    ws = wb["Base_Zonas"]

    filas_clasificadas = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        localidad, _provincia, cp, zona = row[0], row[1], row[2], row[3]
        if not zona:
            continue
        nombre_cordon = MAPA_CORDON.get(str(zona).strip())
        if not nombre_cordon:
            print(f"AVISO: zona desconocida '{zona}' para {localidad} / {cp} — se omite.")
            continue
        cp_norm = normalizar_cp(cp)
        if not localidad or not cp_norm:
            continue
        filas_clasificadas.append({
            "nombre_original": str(localidad).strip(),
            "nombre_norm": normalizar(localidad),
            "cp": cp_norm,
            "cordon_nombre": nombre_cordon,
        })

    print(f"Filas clasificadas en el archivo: {len(filas_clasificadas)}")

    # Dedup por (nombre_norm, cp): nos quedamos con la ÚLTIMA ocurrencia del
    # archivo (Base_Zonas no tiene timestamp para saber cuál es "más
    # reciente" — son pocos casos de conflicto real, confirmado antes).
    por_clave = {}
    for f in filas_clasificadas:
        por_clave[(f["nombre_norm"], f["cp"])] = f
    filas_finales = list(por_clave.values())
    print(f"Filas a importar tras deduplicar (Localidad+CP únicos): {len(filas_finales)}")

    if args.dry_run:
        print("(--dry-run: no se conecta a la base)")
        for f in filas_finales[:5]:
            print(f)
        return

    import os

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("Falta SUPABASE_DB_URL en el entorno (o scripts/.env).")

    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(url, connect_timeout=10)
    try:
        with conn:
            with conn.cursor() as cur:
                # Mapa de id de Cordón por nombre (CABA/GBA1/GBA2/GBA3) — ya
                # deben existir (ABM de Cordones, feature de Precios por
                # Cliente).
                cur.execute("select nombre, id from public.parametros_cordones")
                ids_cordon = {nombre: cid for nombre, cid in cur.fetchall()}
                faltantes = set(MAPA_CORDON.values()) - set(ids_cordon)
                if faltantes:
                    sys.exit(f"Faltan estos Cordones en parametros_cordones: {faltantes}")

                # Localidades existentes (por nombre normalizado) — reusamos
                # el mismo normalizar_texto_localidad() de la migración acá
                # en Python para no depender de ida y vuelta a la base por
                # cada fila.
                cur.execute("select id, nombre from public.parametros_localidades")
                existentes = {normalizar(nombre): lid for lid, nombre in cur.fetchall()}

                nombres_a_crear = {}
                for f in filas_finales:
                    if f["nombre_norm"] not in existentes and f["nombre_norm"] not in nombres_a_crear:
                        nombres_a_crear[f["nombre_norm"]] = f["nombre_original"]

                if nombres_a_crear:
                    nuevas = psycopg2.extras.execute_values(
                        cur,
                        "insert into public.parametros_localidades (nombre, activo) values %s returning id, nombre",
                        [(nombre, True) for nombre in nombres_a_crear.values()],
                        fetch=True,
                    )
                    for lid, nombre in nuevas:
                        existentes[normalizar(nombre)] = lid
                print(f"Localidades nuevas creadas: {len(nombres_a_crear)}")

                filas_cps = [
                    (existentes[f["nombre_norm"]], f["cp"], ids_cordon[f["cordon_nombre"]])
                    for f in filas_finales
                ]
                psycopg2.extras.execute_values(
                    cur,
                    """
                    insert into public.parametros_localidad_cps (localidad_id, cp, cordon_id)
                    values %s
                    on conflict (localidad_id, cp) do update set cordon_id = excluded.cordon_id
                    """,
                    filas_cps,
                )
                print(f"Filas insertadas/actualizadas en parametros_localidad_cps: {len(filas_cps)}")
                print("(el cruce con Envíos ya existentes lo aplica el trigger trg_cruzar_cordon_en_envios automáticamente)")
        print("Listo — importación completa.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
