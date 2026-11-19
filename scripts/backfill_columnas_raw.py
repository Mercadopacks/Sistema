"""
backfill_columnas_raw.py
--------------------------
Migración de una sola vez (ver reglas_de_negocio.md, changelog 2026-11-19):
promueve todo lo que vive dentro de envios.raw a las columnas nuevas
(migración 2026-11-19d_columnas_desde_raw.sql) y separa los 5 campos
sensibles del destinatario en envios_contacto_destinatario, para los
~24.000 envíos que ya existían antes de este cambio. Los envíos nuevos ya
vienen con estas columnas pobladas directo por publicar_supabase.py (no
hace falta correr esto de nuevo salvo para completar históricos).

`col_37` y la clave vacía que a veces aparecen en raw (artefactos de
parseo del Excel en algunos lotes viejos, <1% de las filas, ver
reglas_de_negocio.md) no se migran a ningún lado — se pierden al borrar
`raw` en la migración siguiente, a propósito (no vale la pena una columna
para eso).

Uso:
    python backfill_columnas_raw.py [--dry-run]

Necesita: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (entorno o scripts/.env).
"""

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from publicar_supabase import texto_o_none, parsear_fecha, numero_o_none  # noqa: E402

load_dotenv()

LOTE_LECTURA = 1000
LOTE_ESCRITURA = 300


def campos_envio(id_interno, raw):
    return {
        "id_interno": id_interno,
        "cp": texto_o_none(raw.get("CP")),
        "origen": texto_o_none(raw.get("Origen")),
        "precio": numero_o_none(raw.get("Precio")),
        "provincia": texto_o_none(raw.get("Provincia")),
        "cod_cliente": texto_o_none(raw.get("Cod.Cliente")),
        "fecha_venta": parsear_fecha(raw.get("Fecha Venta")),
        "id_venta_ml": texto_o_none(raw.get("ID venta ML")),
        "zona_precio": texto_o_none(raw.get("Zona precio")),
        "quien_estado": texto_o_none(raw.get("Quien estado")),
        "razon_social": texto_o_none(raw.get("Razon Social")),
        "url_tracking": texto_o_none(raw.get("URl Tracking")),
        "fecha_colecta": parsear_fecha(raw.get("Fecha Colecta")),
        "nombre_cuenta": texto_o_none(raw.get("Nombre cuenta")),
        "usuario_ml_id": texto_o_none(raw.get("Usuario ML ID")),
        "tipo_direccion": texto_o_none(raw.get("Tipo direccion")),
        "total_a_cobrar": numero_o_none(raw.get("Total a cobrar")),
        "metodo_envio": texto_o_none(raw.get("Método de envío")),
        "comentario_destino": texto_o_none(raw.get("Comentario Destino")),
    }


def campos_contacto(id_interno, raw):
    return {
        "id_interno": id_interno,
        "nombre_destinatario": texto_o_none(raw.get("Nombre Destinatario")),
        "direccion": texto_o_none(raw.get("Dirección")),
        "telefono_destinatario": texto_o_none(raw.get("Tel. Destinatario")),
        "email_destinatario": texto_o_none(raw.get("Email Destinatario")),
        "latitud": numero_o_none(raw.get("Latitud")),
        "longitud": numero_o_none(raw.get("Longitud")),
    }


def main():
    dry_run = "--dry-run" in sys.argv[1:]

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    print("Leyendo envíos existentes (con raw todavía cargado)...")
    envios_envio = []
    envios_contacto = []
    desde = 0
    total_leidos = 0
    sin_raw = 0
    while True:
        # .order() es obligatorio acá: sin un orden explícito, Postgres no
        # garantiza que la paginación por .range() sea estable si la tabla
        # se sigue escribiendo en paralelo (el cron de producción corre
        # cada 10 min) — bug real 2026-11-19, se saltearon ~12.800 filas
        # en la primera corrida porque el "orden natural" se corrió entre
        # una página y la siguiente mientras entraban envíos nuevos.
        bloque = sb.table("envios").select("id_interno,raw").is_("origen", "null").order("id_interno").range(desde, desde + LOTE_LECTURA - 1).execute().data
        for fila in bloque:
            total_leidos += 1
            raw = fila.get("raw")
            if not raw:
                sin_raw += 1
                continue
            envios_envio.append(campos_envio(fila["id_interno"], raw))
            envios_contacto.append(campos_contacto(fila["id_interno"], raw))
        if len(bloque) < LOTE_LECTURA:
            break
        desde += LOTE_LECTURA

    print(f"{total_leidos} envíos leídos, {sin_raw} sin raw (ya migrados o nuevos, se saltean).")
    print(f"{len(envios_envio)} para completar columnas + tabla de contacto.")

    if dry_run:
        print("(--dry-run: no se escribió nada en Supabase)")
        if envios_envio:
            print("Ejemplo de fila envios:", envios_envio[0])
            print("Ejemplo de fila contacto:", envios_contacto[0])
        return

    if not envios_envio:
        print("Nada para actualizar.")
        return

    for i in range(0, len(envios_envio), LOTE_ESCRITURA):
        lote = envios_envio[i:i + LOTE_ESCRITURA]
        sb.rpc("actualizar_envio_campos_lote", {"filas": lote}).execute()
        print(f"  envios: {min(i + LOTE_ESCRITURA, len(envios_envio))}/{len(envios_envio)}")

    for i in range(0, len(envios_contacto), LOTE_ESCRITURA):
        lote = envios_contacto[i:i + LOTE_ESCRITURA]
        sb.table("envios_contacto_destinatario").upsert(lote, on_conflict="id_interno").execute()
        print(f"  envios_contacto_destinatario: {min(i + LOTE_ESCRITURA, len(envios_contacto))}/{len(envios_contacto)}")

    print("Listo.")


if __name__ == "__main__":
    main()
