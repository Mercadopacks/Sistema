"""
aplicar_migracion.py
------------------------------------
Aplica un archivo de scripts/migraciones/*.sql directo contra la base de
Supabase, por conexión Postgres directa (SUPABASE_DB_URL, pooler en modo
sesión — ver README.md). Reemplaza copiar/pegar el SQL a mano en el SQL
Editor de Supabase para las migraciones que así se pida.

REGLA DEL PROYECTO (2026-11-20, pedido explícito del usuario): esto se
corre SOLO cuando el usuario lo pide explícitamente en el momento ("dale,
aplicala" / "corréla"), nunca automático apenas se escribe un archivo de
migración — mismo criterio que un `git push`. La conexión directa tiene
permisos totales (igual que el SQL Editor, incluido DROP), así que no es
un paso a automatizar sin esa confirmación puntual.

Uso:
    python aplicar_migracion.py migraciones/2026-11-20_archivo.sql
    python aplicar_migracion.py migraciones/2026-11-20_archivo.sql --dry-run   # solo muestra el SQL, no conecta

Necesita SUPABASE_DB_URL en el entorno (o scripts/.env) — connection
string de "Connect" > "Direct connection"/"Session pooler" > URI, con la
contraseña real de la base (no SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY,
que son para la REST API y no permiten DDL).
"""

import os
import sys

from dotenv import load_dotenv

load_dotenv()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv[1:]

    if not args:
        sys.exit("Uso: python aplicar_migracion.py migraciones/<archivo>.sql [--dry-run]")

    ruta = args[0]
    if not os.path.isabs(ruta):
        ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), ruta)
    if not os.path.isfile(ruta):
        sys.exit(f"No se encontró el archivo: {ruta}")

    with open(ruta, "r", encoding="utf-8") as f:
        sql = f.read()

    if dry_run:
        print(f"(--dry-run: {len(sql)} caracteres, no se conecta a la base)")
        print(sql)
        return

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("Falta SUPABASE_DB_URL en el entorno (o scripts/.env).")

    import psycopg2

    print(f"Conectando y aplicando: {os.path.basename(ruta)}")
    conn = psycopg2.connect(url, connect_timeout=10)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(sql)
                # Sin esto, PostgREST sigue usando su caché de esquema vieja y
                # una tabla/columna nueva tira "Could not find X in the schema
                # cache" (PGRST205) hasta que se refresca solo, minutos después
                # — bug real visto con lightdata_cuentas y de nuevo con
                # parametros_cordones/parametros_tamanos_paquete (2026-11-21).
                cur.execute("NOTIFY pgrst, 'reload schema';")
        print("Listo — migración aplicada (esquema de PostgREST recargado).")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
