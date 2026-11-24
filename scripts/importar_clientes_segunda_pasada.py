"""
importar_clientes_segunda_pasada.py
------------------------------------
Segunda pasada de importar_precios_clientes.py / importar_colectas_clientes.py
para los ~23 nombres que no matchearon exacto pero sí por similitud alta
(sufijo legal SRL/SA, typo menor, texto entre paréntesis) — revisados a
mano uno por uno, no aplicados a ciegas por el ratio de similitud solo.

Uso:
    python importar_clientes_segunda_pasada.py "<Clientes.xlsx>" "<Repartidores.xlsx>" [--dry-run]
"""

import argparse
import sys
import unicodedata

from dotenv import load_dotenv

load_dotenv()

# nombre tal cual aparece en la hoja -> nombre real en lightdata_clientes
# (revisados a mano, ver conversación 2026-11-24).
ALIAS = {
    "AFJ IMPRESIONES": "AFJ.Impresiones3D",
    "ALTO IMPACTO PINTURAS OMBU": "Alto Impacto Pinturas",
    "BACK BONE": "BackBone",
    "BANCHEROS SANITARIOS": "Banchero Sanitarios",
    "CHILLIPARTS": "Chilliparts SRL",
    "COCO KIDS": "Cocos Kids",
    "FLIA HDC GROUP": "FLIA HDC GROUP S.R.L",
    "GONZALO ANDONIAN (KARUN)": "Gonzalo Andonian",
    "GX TRONIC": "GX Tronics",
    "HOGAR DECO ONLINE": "Hogardecoonline",
    "INDUMENTARIA DOMI": "Indumentaria Domi SA",
    "INDUSTRIAS PROMISUR": "Industrias Promisur SRL",
    "KROBRASTOYS": "Krobras Toys",
    "LA BOUTIQUE SPORTS": "La Boutique Sport",
    "LENCERIA MONAMOUR": "Lenceria Mon Amour",
    "MB GROUP": "MBGroup",
    "MIO HOME": "Mio Home SA",
    "PERDRIEL AUTOCHAPA": "Perdriel Autochapa SRL",
    "PIMPERS PARADISE": "Pimpers Paradise SRL",
    "RIPE INSUMOS": "Ripe Insumos SRL",
    "TU AROMA": "TuAroma",
    "TU NAVE": "TuNave",
    "WORKSHOP": "Work@Shop",
    "ZUK ZUK": "Zuk-Zuk",
}


def norm(s):
    if s is None:
        return ""
    s = unicodedata.normalize("NFD", str(s).strip())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.upper()


ALIAS_NORM = {norm(k): norm(v) for k, v in ALIAS.items()}

MAPA_CORDON_COL = {"CABA": "CABA", "Z1": "GBA1", "Z2": "GBA2", "Z3": "GBA3"}


def importar_precios(archivo, mapa_clientes, ids_tamano, ids_cordon, cur, dry_run):
    import openpyxl
    import psycopg2.extras

    wb = openpyxl.load_workbook(archivo, read_only=True, data_only=True)
    ws = wb["Precios_Cliente"]
    aplicados = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        if not row[0]:
            continue
        nombre_norm = norm(row[0])
        if nombre_norm not in ALIAS_NORM:
            continue
        target = ALIAS_NORM[nombre_norm]
        if target not in mapa_clientes:
            print(f"AVISO: alias '{row[0]}' -> target no encontrado en la base, se omite.")
            continue
        did = mapa_clientes[target]
        pequeno = {"CABA": row[1] or 0, "GBA1": row[2] or 0, "GBA2": row[3] or 0, "GBA3": row[4] or 0}
        mediano_grande = {"CABA": row[5] or 0, "GBA1": row[6] or 0, "GBA2": row[7] or 0, "GBA3": row[8] or 0}
        turbo = row[9] or 0
        flete = {"CABA": row[11] or 0, "GBA1": row[12] or 0, "GBA2": row[13] or 0, "GBA3": row[14] or 0}
        deposito = row[15] or 0
        despacho = row[16] or 0
        tipo_servicio = "fulfillment" if (deposito or despacho) else "ultima_milla"
        print(f"Precios: '{row[0]}' -> did {did} ({tipo_servicio})")
        aplicados += 1
        if dry_run:
            continue
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
            (did, tipo_servicio, deposito or None, despacho or None, turbo or None),
        )
        precios_cliente_id = cur.fetchone()[0]
        filas_envio = []
        for cordon_nombre, precio in pequeno.items():
            filas_envio.append((precios_cliente_id, ids_tamano["Pequeño"], ids_cordon[cordon_nombre], precio))
        for cordon_nombre, precio in mediano_grande.items():
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
        filas_flete = [(precios_cliente_id, ids_cordon[cordon_nombre], precio) for cordon_nombre, precio in flete.items()]
        psycopg2.extras.execute_values(
            cur,
            """
            insert into public.precios_cliente_flete (precios_cliente_id, cordon_id, precio)
            values %s
            on conflict (precios_cliente_id, cordon_id) do update set precio = excluded.precio
            """,
            filas_flete,
        )
    print(f"Precios: {aplicados} clientes de la segunda pasada procesados.")


def importar_colectas(archivo, mapa_clientes, cur, dry_run):
    import openpyxl

    wb = openpyxl.load_workbook(archivo, read_only=True, data_only=True)
    ws = wb["Base_Colectas"]
    aplicados = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        tienda, direccion, localidad, estado, turno, dias, refuerzo, hora = row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7]
        if not tienda or not direccion:
            continue
        nombre_norm = norm(tienda)
        if nombre_norm not in ALIAS_NORM:
            continue
        target = ALIAS_NORM[nombre_norm]
        if target not in mapa_clientes:
            continue
        did = mapa_clientes[target]
        direccion = str(direccion).strip()
        localidad_v = str(localidad).strip() if localidad else None
        turno_v = str(turno).strip() if turno else None
        dias_v = str(dias).strip() if dias else None
        refuerzo_v = str(refuerzo).strip().upper() == "SI" if refuerzo else False
        hora_v = hora.strftime("%H:%M") if hasattr(hora, "strftime") else None

        # Idempotente: si ya existe una fila igual para este cliente, no duplica.
        cur.execute(
            "select 1 from public.clientes_colectas where did_cliente=%s and direccion=%s and coalesce(turno,'')=coalesce(%s,'')",
            (did, direccion, turno_v),
        )
        if cur.fetchone():
            continue
        print(f"Colecta: '{tienda}' -> did {did} ({direccion})")
        aplicados += 1
        if dry_run:
            continue
        cur.execute(
            """
            insert into public.clientes_colectas (did_cliente, direccion, localidad, turno, dias, refuerzo, hora)
            values (%s, %s, %s, %s, %s, %s, %s)
            """,
            (did, direccion, localidad_v, turno_v, dias_v, refuerzo_v, hora_v),
        )
    print(f"Colectas: {aplicados} filas de la segunda pasada procesadas.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archivo_clientes")
    parser.add_argument("archivo_repartidores")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    import os
    import psycopg2

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("Falta SUPABASE_DB_URL en el entorno (o scripts/.env).")

    conn = psycopg2.connect(url, connect_timeout=10)
    try:
        cur = conn.cursor()
        cur.execute("select did, nombre_fantasia from public.lightdata_clientes")
        mapa_clientes = {norm(nombre): did for did, nombre in cur.fetchall()}
        cur.execute("select nombre, id from public.parametros_tamanos_paquete")
        ids_tamano = {nombre: tid for nombre, tid in cur.fetchall()}
        cur.execute("select nombre, id from public.parametros_cordones")
        ids_cordon = {nombre: cid for nombre, cid in cur.fetchall()}

        importar_precios(args.archivo_clientes, mapa_clientes, ids_tamano, ids_cordon, cur, args.dry_run)
        importar_colectas(args.archivo_repartidores, mapa_clientes, cur, args.dry_run)

        if args.dry_run:
            conn.rollback()
            print("(--dry-run: no se guardó nada)")
        else:
            conn.commit()
            print("Listo.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
