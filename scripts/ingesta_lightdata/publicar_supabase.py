"""
Sube el export crudo de LightData "tal cual" a Supabase (tabla `envios`)
para Mercadopacks Sistema — ver reglas_de_negocio.md de este repo.
Automatizado desde 2026-11-16 vía .github/workflows/publicar_supabase.yml
(cron-job.org, cada 10 min en horario operativo).

Este repo es independiente del de producción (Firestore, repo
mercadopacks-metricas-diarias) — `descargar_lightdata.py`/
`fecha_descarga.py`/`generar_reporte.py` son copias deliberadas de ese
repo, no un submódulo ni un paquete compartido (ver reglas_de_negocio.md,
"Separación de repos", para la razón y la advertencia de que hay que
mantenerlas sincronizadas a mano si LightData cambia el formato del
export). Corre contra un proyecto de Supabase separado del de producción,
usando las credenciales en `scripts/.env` en corridas locales, o los
secrets de GitHub Actions en el workflow.

Uso: python publicar_supabase.py <archivo_crudo.xls>
"""
import os
import sys
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

sys.path.insert(0, str(Path(__file__).parent))
from generar_reporte import cargar_export  # noqa: E402  (reusa la lectura ya resuelta del .xls)

LOTE = 500


def normalizar_id(valor) -> str | None:
    """'1034944.0' (float de pandas) -> '1034944'. Nunca se asume que viene
    como string limpio: Excel/pandas puede leer una columna numérica como
    float aunque LightData la muestre sin decimales."""
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    try:
        return str(int(float(valor)))
    except (TypeError, ValueError):
        texto = str(valor).strip()
        return texto or None


def texto_o_none(valor) -> str | None:
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    texto = str(valor).strip()
    return texto or None


def parsear_fecha(valor) -> str | None:
    """Acepta 'dd/mm/yyyy HH:MM' o 'dd/mm/yyyy' (formato real de LightData,
    ver diccionario_de_datos.md) y devuelve ISO 8601 con offset -03:00.

    LightData entrega estas fechas en hora de Argentina (ART = UTC-3 fijo,
    sin horario de verano, mismo criterio que el resto del proyecto — ver
    reglas_de_negocio.md) pero SIN indicarlo: el valor crudo es un
    datetime "naive". Si se manda tal cual a una columna timestamptz,
    Postgres lo toma como UTC y el resultado queda 3 horas adelantado
    (bug real detectado 2026-11-15 antes de usar estas columnas para el
    corte de las 21hs) — por eso acá se agrega el offset explícito.
    """
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    if isinstance(valor, str) and not valor.strip():
        return None
    dt = pd.to_datetime(valor, dayfirst=True, errors="coerce")
    if pd.isna(dt):
        return None
    return dt.isoformat() + "-03:00"


def numero_o_none(valor) -> float | None:
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def construir_filas(df: pd.DataFrame) -> list[dict]:
    """
    Fila de `envios` — ya NO incluye `raw` (auditoría 2026-11-19, ver
    reglas_de_negocio.md): todo lo que traía el Excel ahora es una columna
    propia, promovida acá mismo, salvo los 5 campos sensibles del
    destinatario (Nombre/Dirección/Tel./Email/Latitud/Longitud), que van
    aparte en `envios_contacto_destinatario` (construir_filas_contacto) —
    RLS por fila no alcanza para esconder columnas dentro de la MISMA
    tabla, por eso la separación real es en otra tabla.
    """
    filas = []
    for _, fila in df.iterrows():
        id_interno = normalizar_id(fila.get("ID (Interno)"))
        if not id_interno:
            continue  # misma regla que cargar_export: sin ID (Interno) no es un envío real

        fecha_mp_iso = parsear_fecha(fila.get("Fecha MercadoPacks"))
        filas.append({
            "id_interno": id_interno,
            "tracking": texto_o_none(fila.get("Número Tracking")),
            "cliente": texto_o_none(fila.get("Nombre Fantasia")),
            "localidad": texto_o_none(fila.get("Localidad")),
            "zona": texto_o_none(fila.get("Zona")),
            "estado": texto_o_none(fila.get("Estado")),
            # Promovidas desde el raw (ver diccionario_de_datos.md: ninguna de
            # las dos viene estandarizada) para que el módulo de
            # Fallidos/Cambios pueda filtrarlas sin tener que parsear jsonb en
            # cada consulta — el Estado de Lightdata no define un Cambio
            # (describe el paquete NUEVO entregado, no si el chofer ya trajo
            # el original), así que la señal real es Logistica Inversa /
            # Observaciones.
            "logistica_inversa": texto_o_none(fila.get("Logistica Inversa")),
            "observaciones": texto_o_none(fila.get("Observaciones")),
            "cadete": texto_o_none(fila.get("Cadete")),
            # Pedido 2026-11-23: antes se truncaba a solo fecha ([:10]) aunque
            # Lightdata manda hora real — la columna pasó de `date` a
            # `timestamptz` (ver migración
            # 2026-11-23_fecha_mercadopacks_con_hora.sql) para no perderla.
            "fecha_mercadopacks": fecha_mp_iso,
            "fecha_estado": parsear_fecha(fila.get("Fecha estado")),
            "fecha_asignacion": parsear_fecha(fila.get("Fecha de asignación")),
            "fecha_a_planta": parsear_fecha(fila.get("Fecha a planta")),
            "cp": texto_o_none(fila.get("CP")),
            "origen": texto_o_none(fila.get("Origen")),
            "precio": numero_o_none(fila.get("Precio")),
            "provincia": texto_o_none(fila.get("Provincia")),
            "cod_cliente": texto_o_none(fila.get("Cod.Cliente")),
            "fecha_venta": parsear_fecha(fila.get("Fecha Venta")),
            "id_venta_ml": texto_o_none(fila.get("ID venta ML")),
            "zona_precio": texto_o_none(fila.get("Zona precio")),
            "quien_estado": texto_o_none(fila.get("Quien estado")),
            "razon_social": texto_o_none(fila.get("Razon Social")),
            "url_tracking": texto_o_none(fila.get("URl Tracking")),
            "fecha_colecta": parsear_fecha(fila.get("Fecha Colecta")),
            "nombre_cuenta": texto_o_none(fila.get("Nombre cuenta")),
            "usuario_ml_id": texto_o_none(fila.get("Usuario ML ID")),
            "tipo_direccion": texto_o_none(fila.get("Tipo direccion")),
            "total_a_cobrar": numero_o_none(fila.get("Total a cobrar")),
            "metodo_envio": texto_o_none(fila.get("Método de envío")),
            "comentario_destino": texto_o_none(fila.get("Comentario Destino")),
        })
    return filas


def construir_filas_contacto(df: pd.DataFrame) -> list[dict]:
    """Datos sensibles del destinatario — ver nota en construir_filas()."""
    filas = []
    for _, fila in df.iterrows():
        id_interno = normalizar_id(fila.get("ID (Interno)"))
        if not id_interno:
            continue
        filas.append({
            "id_interno": id_interno,
            "nombre_destinatario": texto_o_none(fila.get("Nombre Destinatario")),
            "direccion": texto_o_none(fila.get("Dirección")),
            "telefono_destinatario": texto_o_none(fila.get("Tel. Destinatario")),
            "email_destinatario": texto_o_none(fila.get("Email Destinatario")),
            "latitud": numero_o_none(fila.get("Latitud")),
            "longitud": numero_o_none(fila.get("Longitud")),
        })
    return filas


def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: publicar_supabase.py <archivo_crudo.xls>")

    ruta = Path(sys.argv[1])
    if not ruta.exists():
        sys.exit(f"No se encontró el archivo: {ruta}")

    # El .env real vive en scripts/.env (compartido por todas las
    # subcarpetas de scripts/, ver README.md) — este archivo se movió a
    # scripts/ingesta_lightdata/ en la reorganización 2026-11-20.
    load_dotenv(Path(__file__).parent.parent / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (ver scripts/.env)")

    print(f"Leyendo {ruta} ...")
    df = cargar_export(ruta)
    print(f"{len(df)} filas en el export crudo.")

    filas = construir_filas(df)
    print(f"{len(filas)} filas válidas (con ID (Interno)) para subir a Supabase.")
    if not filas:
        sys.exit("Nada para subir.")

    filas_contacto = construir_filas_contacto(df)

    client = create_client(url, key)
    for i in range(0, len(filas), LOTE):
        lote = filas[i:i + LOTE]
        client.table("envios").upsert(lote, on_conflict="id_interno").execute()
        print(f"  envios: {min(i + LOTE, len(filas))}/{len(filas)}")

    for i in range(0, len(filas_contacto), LOTE):
        lote = filas_contacto[i:i + LOTE]
        client.table("envios_contacto_destinatario").upsert(lote, on_conflict="id_interno").execute()
        print(f"  envios_contacto_destinatario: {min(i + LOTE, len(filas_contacto))}/{len(filas_contacto)}")

    print("Listo.")


if __name__ == "__main__":
    main()
