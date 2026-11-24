"""
importar_colectas_clientes.py
------------------------------------
Importa la hoja "Base_Colectas" de "1. Informacion Base Repartidores.xlsx"
(TIENDA, DIRECCION, LOCALIDAD, ESTADO, TURNO, DIAS COLECTA, REFUERZO,
HORA DE COLECTA, + 4 columnas de precio por tipo de vehículo que NO se
migran — pedido explícito, "por ahora a los precios no le prestes
atención") a `clientes_colectas`.

Un mismo cliente (TIENDA) puede tener varias filas — distintas
direcciones, o el mismo lugar con turno Mañana y Tarde por separado — se
migran todas tal cual, sin intentar fusionarlas.

El cliente se matchea por nombre normalizado contra
lightdata_clientes.nombre_fantasia — los que no matcheen se listan al
final para revisar a mano (no se inventan clientes nuevos).

Uso:
    python importar_colectas_clientes.py "C:\\ruta\\1. Informacion Base Repartidores.xlsx" [--dry-run]
"""

import argparse
import sys
import unicodedata

from dotenv import load_dotenv

load_dotenv()


def norm(s):
    if s is None:
        return ""
    s = unicodedata.normalize("NFD", str(s).strip())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.upper()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archivo")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    import openpyxl

    wb = openpyxl.load_workbook(args.archivo, read_only=True, data_only=True)
    ws = wb["Base_Colectas"]

    filas = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        tienda, direccion, localidad, estado, turno, dias, refuerzo, hora = row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7]
        if not tienda or not direccion:
            continue
        filas.append({
            "nombre": str(tienda).strip(), "nombre_norm": norm(tienda),
            "direccion": str(direccion).strip(),
            "localidad": str(localidad).strip() if localidad else None,
            "turno": str(turno).strip() if turno else None,
            "dias": str(dias).strip() if dias else None,
            "refuerzo": str(refuerzo).strip().upper() == "SI" if refuerzo else False,
            "hora": hora.strftime("%H:%M") if hasattr(hora, "strftime") else None,
        })

    print(f"Filas en Base_Colectas: {len(filas)}")

    import os

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("Falta SUPABASE_DB_URL en el entorno (o scripts/.env).")

    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(url, connect_timeout=10)
    try:
        cur = conn.cursor()
        cur.execute("select did, nombre_fantasia from public.lightdata_clientes")
        mapa_clientes = {norm(nombre): did for did, nombre in cur.fetchall()}

        matcheados = [f for f in filas if f["nombre_norm"] in mapa_clientes]
        sin_match = sorted(set(f["nombre"] for f in filas if f["nombre_norm"] not in mapa_clientes))
        print(f"Filas matcheadas: {len(matcheados)} / {len(filas)}")
        print(f"Tiendas sin match (no se tocan, revisar a mano): {len(sin_match)}")
        for n in sin_match:
            print(f"  - {n}")

        if args.dry_run:
            print("(--dry-run: no se conecta a la base)")
            return

        valores = [
            (mapa_clientes[f["nombre_norm"]], f["direccion"], f["localidad"], f["turno"], f["dias"], f["refuerzo"], f["hora"])
            for f in matcheados
        ]
        psycopg2.extras.execute_values(
            cur,
            """
            insert into public.clientes_colectas (did_cliente, direccion, localidad, turno, dias, refuerzo, hora)
            values %s
            """,
            valores,
        )
        conn.commit()
        print(f"Listo — {len(valores)} filas de colecta insertadas.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
