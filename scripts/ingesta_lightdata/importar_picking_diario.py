"""
importar_picking_diario.py
------------------------------------
PUENTE TEMPORAL (pedido 2026-11-28) — ver docs/migracion_picking_historico.md
para la explicación completa, el setup paso a paso y, sobre todo, CÓMO
CORTAR este proceso el día que se migre la operación de Picking
Medianos/Grandes por completo a este sistema (reemplazando el escaneo en
la planilla vieja por la pantalla "Picking Tamaños" que ya existe acá).

Qué hace: el proceso actual (fuera de este repo) funciona así:
  1. Durante el día se escanea en el archivo PRINCIPAL de Picking
     Medianos y Grandes (Google Sheets).
  2. A las 00:00 ART, un proceso de ESE lado vuelca los escaneos del día
     a la hoja "Historico" de la planilla de Picking_historia:
     https://docs.google.com/spreadsheets/d/14hzHl977uKLmk3H_se8mhoQM5dgpPZdh94BP1rN2cUM
     (columnas: ESCANEO, FECHA Y HORA, TAMAÑO, ID NORMALIZADO, TIPO DE ENVIO
     — mismo schema que ya migramos una vez a mano con
     importar_picking_historico.py).

Este script corre después de ese volcado (pensado para las 02:00 ART, ver
.github/workflows/picking_historico_diario.yml), lee la hoja "Historico"
vía la API de Google Sheets, se queda con los escaneos de AYER (fecha ART)
y los sube a `picking_tamanos` — exactamente la misma tabla y el mismo
criterio de dedup/upsert que ya usa `importar_picking_historico.py` (nos
quedamos con el escaneo MÁS RECIENTE de cada id_normalizado; "Revisar_Manual"
se repite legítimamente, nunca se pisa a sí mismo). El cruce contra
`envios.tamano` lo sigue disparando solo el trigger `trg_cruzar_tamano_en_envios`
(2026-11-23_sincronizar_tamano_envios.sql) en cada insert/update — este
script no lo toca.

Por qué psycopg2 (SUPABASE_DB_URL) y no el cliente REST de Supabase (a
diferencia del resto de scripts/ingesta_lightdata/, que usan SUPABASE_URL +
SUPABASE_SERVICE_ROLE_KEY): necesitamos el UPDATE condicional "solo si el
dato nuevo es más reciente que el que ya hay" (`where excluded.creado_en >
picking_tamanos.creado_en`), que el upsert de PostgREST no puede expresar.
Mismo criterio ya usado en importar_picking_historico.py.

Uso:
    python importar_picking_diario.py [--fecha 2026-11-27] [--dry-run]
    python importar_picking_diario.py --desde 2026-11-22 --hasta 2026-11-26

--fecha: por si hay que correrlo a mano para un día puntual (reintento
tras una falla, etc.) — por defecto, AYER en hora ART.
--desde/--hasta: para backfillear varios días de una sola corrida (ej. el
setup inicial del puente, o un hueco por una falla de varios días) — lee
la hoja UNA sola vez y procesa cada día del rango por separado (mismo
dedup por día que el modo de un solo día, no se mezclan escaneos de días
distintos). No se puede combinar con --fecha.

Necesita en el entorno (o scripts/.env):
  GOOGLE_SHEETS_CREDENTIALS_JSON  JSON completo de la service account de
                                  Google (ver docs/migracion_picking_historico.md,
                                  paso 1) -- tal cual se descarga, como un
                                  solo secret de una línea o multilínea.
  SUPABASE_DB_URL                 connection string de Postgres directa
                                  (Connect > Session pooler > URI), NO
                                  SUPABASE_URL/SERVICE_ROLE_KEY.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv()

SHEET_ID = "14hzHl977uKLmk3H_se8mhoQM5dgpPZdh94BP1rN2cUM"
SHEET_TAB = "Historico"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def normalizar_id(valor):
    if valor is None:
        return None
    s = str(valor).strip()
    if s.endswith(".0") and s.replace(".0", "").isdigit():
        s = s[:-2]
    return s


def fecha_art_hoy():
    # Mismo criterio ART fijo (UTC-3, sin horario de verano) que el resto
    # del proyecto -- ver fechaART() del frontend y _fecha_art_hoy() de
    # scripts/qa/qa_validar_estado_vivo.py.
    return (datetime.now(timezone.utc) + timedelta(hours=-3)).date()


def leer_filas_sheet():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds_raw = os.environ.get("GOOGLE_SHEETS_CREDENTIALS_JSON")
    if not creds_raw:
        sys.exit("Falta GOOGLE_SHEETS_CREDENTIALS_JSON en el entorno (o scripts/.env).")
    creds_info = json.loads(creds_raw)
    creds = service_account.Credentials.from_service_account_info(creds_info, scopes=SCOPES)
    service = build("sheets", "v4", credentials=creds)

    # Rango abierto (sin tope de fila): la hoja sigue creciendo todos los
    # días, pedir "hasta el final" evita tener que adivinar/mantener un
    # número de fila. El volumen (texto corto, 5 columnas) es chico incluso
    # con decenas de miles de filas.
    resultado = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=f"{SHEET_TAB}!A2:E",
    ).execute()
    return resultado.get("values", [])


def filas_del_dia(filas_crudas, fecha_objetivo):
    filas = []
    for fila in filas_crudas:
        if len(fila) < 4:
            continue  # fila incompleta (TIPO DE ENVIO puede faltar en alguna muy vieja)
        escaneo, fecha_str, tamano, id_norm = fila[0], fila[1], fila[2], fila[3]
        tipo = fila[4] if len(fila) > 4 else None
        try:
            fecha = datetime.strptime(fecha_str, "%d/%m/%Y %H:%M:%S")
        except (ValueError, TypeError):
            continue
        if fecha.date() != fecha_objetivo:
            continue
        filas.append({
            "escaneo_crudo": escaneo,
            "tamano": tamano,
            "id_normalizado": normalizar_id(id_norm) or "Revisar_Manual",
            "tipo_envio": tipo or "Desconocido",
            "creado_en": fecha,
        })
    return filas


def deduplicar(filas):
    # Mismo criterio que importar_picking_historico.py: nos quedamos con
    # el escaneo más reciente por id_normalizado real; "Revisar_Manual" se
    # repite legítimamente (no tiene con qué cruzar, cada escaneo es un
    # caso aparte para revisar a mano).
    por_id = {}
    revisar_manual = []
    for f in filas:
        if f["id_normalizado"] == "Revisar_Manual":
            revisar_manual.append(f)
            continue
        existente = por_id.get(f["id_normalizado"])
        if existente is None or f["creado_en"] > existente["creado_en"]:
            por_id[f["id_normalizado"]] = f
    return list(por_id.values()) + revisar_manual


def _upsertear(conn, filas_finales):
    import psycopg2.extras

    with conn:
        with conn.cursor() as cur:
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


def procesar_dia(filas_crudas, fecha_objetivo, conn, dry_run):
    print(f"Importando escaneos de Picking del {fecha_objetivo.isoformat()}...")
    filas_dia = filas_del_dia(filas_crudas, fecha_objetivo)
    print(f"Filas del {fecha_objetivo.isoformat()}: {len(filas_dia)}")
    if not filas_dia:
        print("Nada para importar -- ¿ya corrió el volcado de medianoche del lado de la planilla?")
        return

    filas_finales = deduplicar(filas_dia)
    reales = len(filas_finales) - sum(1 for f in filas_finales if f["id_normalizado"] == "Revisar_Manual")
    print(f"Filas a upsertear tras deduplicar: {len(filas_finales)} ({reales} ids reales + "
          f"{len(filas_finales) - reales} Revisar_Manual)")

    if dry_run:
        print("(--dry-run: no se conecta a la base)")
        for f in filas_finales[:5]:
            print(f)
        return

    try:
        _upsertear(conn, filas_finales)
        print(f"Listo -- {len(filas_finales)} filas procesadas en picking_tamanos.")
    except Exception:
        conn.rollback()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fecha", help="YYYY-MM-DD -- por defecto, ayer en hora ART")
    parser.add_argument("--desde", help="YYYY-MM-DD -- primer día de un backfill de rango")
    parser.add_argument("--hasta", help="YYYY-MM-DD -- último día (inclusive) de un backfill de rango")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.desde or args.hasta:
        if args.fecha:
            sys.exit("No se puede combinar --fecha con --desde/--hasta.")
        if not (args.desde and args.hasta):
            sys.exit("--desde y --hasta van juntos.")
        fechas_objetivo = []
        actual = datetime.strptime(args.desde, "%Y-%m-%d").date()
        fin = datetime.strptime(args.hasta, "%Y-%m-%d").date()
        if actual > fin:
            sys.exit("--desde no puede ser posterior a --hasta.")
        while actual <= fin:
            fechas_objetivo.append(actual)
            actual += timedelta(days=1)
    else:
        fechas_objetivo = [
            datetime.strptime(args.fecha, "%Y-%m-%d").date()
            if args.fecha else fecha_art_hoy() - timedelta(days=1)
        ]

    filas_crudas = leer_filas_sheet()
    print(f"Filas totales leídas de la hoja '{SHEET_TAB}': {len(filas_crudas)}")

    conn = None
    if not args.dry_run:
        url = os.environ.get("SUPABASE_DB_URL")
        if not url:
            sys.exit("Falta SUPABASE_DB_URL en el entorno (o scripts/.env).")
        import psycopg2
        conn = psycopg2.connect(url, connect_timeout=10)

    try:
        for fecha_objetivo in fechas_objetivo:
            procesar_dia(filas_crudas, fecha_objetivo, conn, args.dry_run)
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    main()
