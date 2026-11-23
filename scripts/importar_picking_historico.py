"""
importar_picking_historico.py
------------------------------------
Importa el histórico de escaneos de Picking Tamaños (archivo Excel
"Picking_Historica.xlsx", hoja "Historico" — mismo schema que generaba
Vaciado Nocturno.txt de la planilla vieja: ESCANEO, FECHA Y HORA, TAMAÑO,
ID NORMALIZADO, TIPO DE ENVIO) a la tabla `picking_tamanos` de Supabase.

Pedido explícito del usuario (2026-11-23): solo los registros del mes
indicado (por defecto, el mes actual) — el resto del histórico (desde
2026-06) NO se importa.

Igual que el escaneo en vivo: el unique index de id_normalizado es parcial
(excluye "Revisar_Manual"), así que para los ids reales nos quedamos con
el escaneo MÁS RECIENTE de ese mes por id_normalizado (si el mismo
paquete se escaneó más de una vez, el último escaneo real es el que
hubiera quedado guardado si hubiese pasado por la app en su momento) y
cruzamos ese tamaño contra `envios.id_interno`/`tracking`, mismo criterio
que el cruce automático de la app.

Uso:
    python importar_picking_historico.py "C:\\ruta\\Picking_Historica.xlsx" [--year 2026] [--month 11] [--dry-run]

Necesita SUPABASE_DB_URL en el entorno (o scripts/.env).
"""

import argparse
import sys
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()


def normalizar_id(valor):
    if valor is None:
        return None
    s = str(valor).strip()
    if s.endswith(".0") and s.replace(".0", "").isdigit():
        s = s[:-2]
    return s


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("archivo")
    parser.add_argument("--year", type=int, default=datetime.now().year)
    parser.add_argument("--month", type=int, default=datetime.now().month)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    import openpyxl

    wb = openpyxl.load_workbook(args.archivo, read_only=True, data_only=True)
    ws = wb["Historico"]

    filas_del_mes = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        escaneo, fecha, tamano, id_norm, tipo = row[0], row[1], row[2], row[3], row[4]
        if escaneo is None and fecha is None:
            continue
        if not fecha or fecha.year != args.year or fecha.month != args.month:
            continue
        filas_del_mes.append({
            "escaneo_crudo": escaneo,
            "tamano": tamano,
            "id_normalizado": normalizar_id(id_norm) or "Revisar_Manual",
            "tipo_envio": tipo or "Desconocido",
            "creado_en": fecha,
        })

    print(f"Filas de {args.year}-{args.month:02d} en el archivo: {len(filas_del_mes)}")

    # Dedup por id_normalizado (excepto "Revisar_Manual", que se repite
    # legítimamente) — nos quedamos con el escaneo más reciente de cada uno.
    por_id = {}
    revisar_manual = []
    for f in filas_del_mes:
        if f["id_normalizado"] == "Revisar_Manual":
            revisar_manual.append(f)
            continue
        existente = por_id.get(f["id_normalizado"])
        if existente is None or f["creado_en"] > existente["creado_en"]:
            por_id[f["id_normalizado"]] = f

    filas_finales = list(por_id.values()) + revisar_manual
    print(f"Filas a insertar tras deduplicar (último escaneo real gana): {len(filas_finales)}"
          f" ({len(por_id)} ids reales + {len(revisar_manual)} Revisar_Manual)")

    if args.dry_run:
        print("(--dry-run: no se conecta a la base)")
        for f in filas_finales[:5]:
            print(f)
        return

    url = __import__("os").environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("Falta SUPABASE_DB_URL en el entorno (o scripts/.env).")

    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(url, connect_timeout=10)
    try:
        with conn:
            with conn.cursor() as cur:
                # ON CONFLICT contra el índice parcial (no contra un
                # upsert "ciego"): puede haber ids que ya existan por
                # escaneos en vivo hechos hoy durante el desarrollo/pruebas
                # — se actualiza solo si el registro que estamos
                # importando es más reciente que el que ya está.
                psycopg2.extras.execute_values(
                    cur,
                    """
                    insert into public.picking_tamanos
                        (escaneo_crudo, tamano, id_normalizado, tipo_envio, creado_en)
                    values %s
                    on conflict (id_normalizado) where id_normalizado <> 'Revisar_Manual'
                    do update set
                        escaneo_crudo = excluded.escaneo_crudo,
                        tamano = excluded.tamano,
                        tipo_envio = excluded.tipo_envio,
                        creado_en = excluded.creado_en
                    where excluded.creado_en > picking_tamanos.creado_en
                    """,
                    [(f["escaneo_crudo"], f["tamano"], f["id_normalizado"], f["tipo_envio"], f["creado_en"])
                     for f in filas_finales],
                )
                print(f"Insertadas {len(filas_finales)} filas en picking_tamanos.")
                # El cruce con Envíos ya NO se hace desde este script: lo
                # dispara automáticamente el trigger trg_cruzar_tamano_en_envios
                # (ver migración 2026-11-23_sincronizar_tamano_envios.sql) en
                # cada insert/update de picking_tamanos.
        print("Listo — importación completa.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
