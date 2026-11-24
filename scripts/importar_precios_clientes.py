"""
importar_precios_clientes.py
------------------------------------
Importa la hoja "Precios_Cliente" de "1. Informacion Base - Clientes.xlsx"
a precios_cliente / precios_cliente_envio / precios_cliente_flete.

Columnas de la hoja (fila 2 = encabezado real):
CLIENTE, P.CABA, P.Z1, P.Z2, P.Z3 (Pequeños),
G.CABA, G.Z1, G.Z2, G.Z3 (Medianos Y Grandes — MISMO precio para los dos
tamaños, así viene la planilla), TURBO, COLECTA (no mapeado, no pedido),
F.CABA, F.Z, F.Z2, F.Z3 (Fletes), DEPOSITO, DESPACHO (Fulfillment).

tipo_servicio se infiere: 'fulfillment' si DEPOSITO o DESPACHO > 0, si no
'ultima_milla'.

El cliente se matchea por nombre normalizado (mayúsculas, sin acentos)
contra lightdata_clientes.nombre_fantasia — los que no matcheen se
listan al final para revisar a mano (no se inventan clientes nuevos acá,
a diferencia del mapeo de Localidad+Cordón).

Uso:
    python importar_precios_clientes.py "C:\\ruta\\1. Informacion Base - Clientes.xlsx" [--dry-run]
"""

import argparse
import sys
import unicodedata

from dotenv import load_dotenv

load_dotenv()

MAPA_CORDON_COL = {"CABA": "CABA", "Z1": "GBA1", "Z2": "GBA2", "Z3": "GBA3"}


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
    ws = wb["Precios_Cliente"]

    filas = []
    for row in ws.iter_rows(min_row=3, values_only=True):
        if not row[0]:
            continue
        nombre = str(row[0]).strip()
        pequeno = {"CABA": row[1] or 0, "GBA1": row[2] or 0, "GBA2": row[3] or 0, "GBA3": row[4] or 0}
        mediano_grande = {"CABA": row[5] or 0, "GBA1": row[6] or 0, "GBA2": row[7] or 0, "GBA3": row[8] or 0}
        turbo = row[9] or 0
        flete = {"CABA": row[11] or 0, "GBA1": row[12] or 0, "GBA2": row[13] or 0, "GBA3": row[14] or 0}
        deposito = row[15] or 0
        despacho = row[16] or 0
        filas.append({
            "nombre": nombre, "nombre_norm": norm(nombre),
            "pequeno": pequeno, "mediano_grande": mediano_grande, "turbo": turbo,
            "flete": flete, "deposito": deposito, "despacho": despacho,
        })

    print(f"Filas en la hoja Precios_Cliente: {len(filas)}")

    if args.dry_run:
        print("(--dry-run: no se conecta a la base todavía, pero sí valido el matching de nombres)")

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
        cur.execute("select nombre, id from public.parametros_tamanos_paquete")
        ids_tamano = {nombre: tid for nombre, tid in cur.fetchall()}
        cur.execute("select nombre, id from public.parametros_cordones")
        ids_cordon = {nombre: cid for nombre, cid in cur.fetchall()}

        matcheados = [f for f in filas if f["nombre_norm"] in mapa_clientes]
        sin_match = [f for f in filas if f["nombre_norm"] not in mapa_clientes]
        print(f"Clientes matcheados: {len(matcheados)} / {len(filas)}")
        print(f"Sin match (no se tocan, revisar a mano): {len(sin_match)}")
        for f in sin_match:
            print(f"  - {f['nombre']}")

        if args.dry_run:
            return

        for f in matcheados:
            did = mapa_clientes[f["nombre_norm"]]
            tipo_servicio = "fulfillment" if (f["deposito"] or f["despacho"]) else "ultima_milla"
            cur.execute(
                """
                insert into public.precios_cliente
                    (did_cliente, tipo_servicio, precio_deposito_pallet, precio_despacho_envio, precio_turbo_envio, activo, actualizado_en)
                values (%s, %s, %s, %s, %s, true, now())
                on conflict (did_cliente) do update set
                    tipo_servicio = excluded.tipo_servicio,
                    precio_deposito_pallet = excluded.precio_deposito_pallet,
                    precio_despacho_envio = excluded.precio_despacho_envio,
                    precio_turbo_envio = excluded.precio_turbo_envio,
                    actualizado_en = now()
                returning id
                """,
                (did, tipo_servicio, f["deposito"] or None, f["despacho"] or None, f["turbo"] or None),
            )
            precios_cliente_id = cur.fetchone()[0]

            filas_envio = []
            for cordon_nombre, precio in f["pequeno"].items():
                filas_envio.append((precios_cliente_id, ids_tamano["Pequeño"], ids_cordon[cordon_nombre], precio))
            for cordon_nombre, precio in f["mediano_grande"].items():
                filas_envio.append((precios_cliente_id, ids_tamano["Mediano"], ids_cordon[cordon_nombre], precio))
                filas_envio.append((precios_cliente_id, ids_tamano["Grande"], ids_cordon[cordon_nombre], precio))
            psycopg2.extras.execute_values(
                cur,
                """
                insert into public.precios_cliente_envio (precios_cliente_id, tamano_paquete_id, cordon_id, precio)
                values %s
                on conflict (precios_cliente_id, tamano_paquete_id, cordon_id) do update set precio = excluded.precio
                """,
                filas_envio,
            )

            filas_flete = [(precios_cliente_id, ids_cordon[cordon_nombre], precio) for cordon_nombre, precio in f["flete"].items()]
            psycopg2.extras.execute_values(
                cur,
                """
                insert into public.precios_cliente_flete (precios_cliente_id, cordon_id, precio)
                values %s
                on conflict (precios_cliente_id, cordon_id) do update set precio = excluded.precio
                """,
                filas_flete,
            )

        conn.commit()
        print(f"Listo — {len(matcheados)} clientes con precios cargados/actualizados.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
