"""
qa_percepcion_carga_inicial.py
--------------------------------
Test de regresión de UX/performance percibida para la clase de bug
reportada 2026-11-27: "se ve muy mecánico: entrás y se ve en blanco,
luego carga el sidebar, luego carga la pantalla principal y luego cargan
los datos — funciona bien pero da sensación de lentitud".

La causa real NO era que el sistema fuera lento (los tiempos de red eran
normales) sino que la transición entre estados no daba ninguna señal de
"está pasando algo": appView pasaba de hidden=true a hidden=false de
golpe, revelando sidebar + tarjetas vacías (sin skeleton) de una, y
encima había un tramo (login enviado -> perfil cargado) con la pantalla
totalmente sin contenido. Fix aplicado en index.html (mismo commit que
agrega este test):
  1. `#boot-loader` (logo con pulso, fondo de marca) cubre CUALQUIER
     tramo entre "se mandó el login" / "se está chequeando sesión" y que
     login o app queden listos para mostrarse — nunca queda la pantalla
     sin nada.
  2. `#app-view` hace un fade-in (opacity, clase `.visible`) en vez de
     aparecer de golpe.
  3. Los contenedores de datos del dashboard de Envíos (`#mini-kpis`,
     `#chart-horas`, la vista que ve cualquiera que entra) arrancan con
     un skeleton shimmer en el HTML estático, así que nunca se ve una
     tarjeta en blanco esperando datos — `cargarResumenEnvios()` lo pisa
     entero con `innerHTML` apenas resuelve, no hace falta tocar ese JS.

Qué verifica este test (contra el `index.html` real, con la red de
Supabase mockeada vía Playwright y latencias artificiales "realistas"
para que el efecto sea observable):
  A. Nunca hay un instante en que login Y app estén ocultos y el
     boot-loader también esté oculto -- "pantalla completamente vacía".
  B. Mientras appView está oculta, sus tarjetas de datos (mini-kpis,
     chart-horas) NO deben estar vacías cuando se la termine mostrando
     (deben tener skeleton puesto desde el HTML estático, no un string
     vacío que recién se llena después del reveal).
  C. appView se muestra con la clase `.visible` (fade), no con un cambio
     de `hidden` sin transición.
  D. No hay errores de JS (`pageerror`) durante toda la secuencia.

Uso:
    python qa_percepcion_carga_inicial.py [--lat-perfil 0.35] [--lat-rest 0.55]

Si ya hay un server corriendo en localhost:8765 (ver skill
`levantar-entorno`) lo usa directamente; si no, levanta uno temporario
sobre la raíz del repo y lo apaga al terminar. No necesita Supabase real
ni `.env` -- toda la red de `/auth/v1/` y `/rest/v1/` queda mockeada, así
que es seguro correrlo en cualquier momento, incluso en CI.

Necesita: playwright (`pip install playwright` + `playwright install
chromium`, una sola vez).
"""

import argparse
import asyncio
import json
import os
import socket
import subprocess
import sys
import time

from playwright.async_api import async_playwright

RAIZ_REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")

FAKE_USER = {
    "id": "11111111-1111-1111-1111-111111111111",
    "aud": "authenticated", "role": "authenticated",
    "email": "qa-carga-inicial@test.com",
    "app_metadata": {}, "user_metadata": {},
    "created_at": "2026-01-01T00:00:00Z",
}

PERFIL_ADMIN = [{
    "id": "perfil-qa-1", "auth_user_id": FAKE_USER["id"],
    "nombre": "QA", "apellido": "Carga Inicial", "es_admin": True,
    "tipo_usuario": "administrativo", "activo": True,
    "vistas_permitidas": [], "clientes_lightdata_ids": [],
}]

# resumen_envios() devuelve un único objeto JSON (no una tabla) -- las
# funciones renderMiniKpis/renderChartHoras/renderCruce/renderZonaTabla/
# renderChoferesTabla (js/pantallas/dashboard-envios.js) leen de ahí
# `resumen.total`, `por_hora`, `por_zona`, `por_chofer`, etc. Este mock
# "vacío pero válido" alcanza para que esa pantalla cargue sin tirar un
# TypeError -- no busca validar los NÚMEROS, solo que la secuencia de
# carga visual no se rompa en el camino.
RESUMEN_ENVIOS_VACIO = {
    "resumen": {"total": 0, "a_retirar": 0, "total_flex": 0, "a_retirar_flex": 0},
    "por_estado_hora": {}, "por_estado_hora_flex": {}, "por_hora": {},
    "por_zona": [], "por_chofer": [],
}


def _token_body():
    return {
        "access_token": "fake.access.token", "token_type": "bearer",
        "expires_in": 3600, "expires_at": int(time.time()) + 3600,
        "refresh_token": "fake-refresh-token", "user": FAKE_USER,
    }


def _puerto_libre(host, puerto):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, puerto)) != 0


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat-perfil", type=float, default=0.35,
                     help="Latencia simulada (seg) para la consulta de perfiles_usuario")
    ap.add_argument("--lat-rest", type=float, default=0.55,
                     help="Latencia simulada (seg) para el resto de llamadas REST/RPC")
    args = ap.parse_args()

    puerto = 8765
    proceso_server = None
    if _puerto_libre("127.0.0.1", puerto):
        puerto = 8766
        proceso_server = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(puerto)],
            cwd=RAIZ_REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(0.6)  # tiempo de arranque del server temporario

    fallas = []

    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg = await b.new_page(viewport={"width": 1366, "height": 900})

            errores_js = []
            pg.on("pageerror", lambda e: errores_js.append(str(e)))

            async def handle_rest(route):
                url = route.request.url
                if "perfiles_usuario" in url:
                    await asyncio.sleep(args.lat_perfil)
                    await route.fulfill(status=200, content_type="application/json",
                                         body=json.dumps(PERFIL_ADMIN))
                elif "resumen_envios" in url:
                    await asyncio.sleep(args.lat_rest)
                    await route.fulfill(status=200, content_type="application/json",
                                         body=json.dumps(RESUMEN_ENVIOS_VACIO))
                else:
                    await asyncio.sleep(args.lat_rest)
                    await route.fulfill(status=200, content_type="application/json", body="[]")

            async def handle_auth(route):
                url = route.request.url
                if "/auth/v1/token" in url:
                    await route.fulfill(status=200, content_type="application/json",
                                         body=json.dumps(_token_body()))
                elif "/auth/v1/user" in url:
                    await route.fulfill(status=200, content_type="application/json",
                                         body=json.dumps(FAKE_USER))
                else:
                    await route.continue_()

            await pg.route("**/rest/v1/**", handle_rest)
            await pg.route("**/rpc/**", handle_rest)
            await pg.route("**/auth/v1/**", handle_auth)

            await pg.goto(f"http://localhost:{puerto}/index.html", wait_until="networkidle")

            await pg.evaluate("""() => {
                window.__m = [];
                window.__t0 = performance.now();
                window.__sampler = setInterval(() => {
                    const loginView = document.getElementById('login-view');
                    const appView = document.getElementById('app-view');
                    const bootLoader = document.getElementById('boot-loader');
                    window.__m.push({
                        t: Math.round(performance.now() - window.__t0),
                        loginOculto: loginView.hidden,
                        appOculto: appView.hidden,
                        appVisibleClase: appView.classList.contains('visible'),
                        bootOculto: bootLoader.classList.contains('oculto'),
                        miniKpisLen: document.getElementById('mini-kpis').innerHTML.trim().length,
                        chartHorasLen: document.getElementById('chart-horas').innerHTML.trim().length,
                    });
                }, 25);
            }""")

            await pg.fill("#login-email", "qa-carga-inicial@test.com")
            await pg.fill("#login-password", "lo-que-sea")
            await pg.click("#login-form button[type=submit], #login-form button")
            await pg.wait_for_timeout(int((args.lat_perfil + args.lat_rest + 1.5) * 1000))

            await pg.evaluate("clearInterval(window.__sampler)")
            muestras = await pg.evaluate("window.__m")
            await b.close()

        # ---- Chequeo A: nunca completamente en blanco ----
        pantalla_vacia = [
            m for m in muestras
            if m["loginOculto"] and m["appOculto"] and m["bootOculto"]
        ]
        if pantalla_vacia:
            fallas.append(
                f"A) Pantalla completamente vacía detectada en {len(pantalla_vacia)} muestra(s), "
                f"ej. t={pantalla_vacia[0]['t']}ms (login oculto, app oculta, boot-loader oculto a la vez)."
            )

        # ---- Chequeo B: las tarjetas de datos no deben estar vacías cuando se revela la app ----
        momento_reveal = next((m for m in muestras if not m["appOculto"]), None)
        if momento_reveal is None:
            fallas.append("B) La app nunca llegó a mostrarse (appOculto siguió true toda la corrida).")
        else:
            if momento_reveal["miniKpisLen"] == 0:
                fallas.append("B) #mini-kpis estaba vacío (sin skeleton) justo cuando se reveló appView.")
            if momento_reveal["chartHorasLen"] == 0:
                fallas.append("B) #chart-horas estaba vacío (sin skeleton) justo cuando se reveló appView.")

        # ---- Chequeo C: el reveal usa la clase .visible (fade), no un corte seco ----
        tuvo_fade = any(m["appVisibleClase"] for m in muestras)
        if not tuvo_fade:
            fallas.append("C) appView nunca llegó a tener la clase 'visible' -- el fade-in no se disparó.")

        # ---- Chequeo D: sin errores de JS ----
        if errores_js:
            fallas.append(f"D) Errores de JS durante la secuencia: {errores_js}")

    finally:
        if proceso_server:
            proceso_server.terminate()
            proceso_server.wait(timeout=5)

    print("=" * 70)
    if fallas:
        print(f"FALLÓ ({len(fallas)} problema[s]):")
        for f in fallas:
            print(f"  - {f}")
        print("=" * 70)
        sys.exit(1)
    else:
        print("OK -- sin pantalla vacía, skeleton presente al revelar, fade-in activo, sin errores JS.")
        print("=" * 70)
        sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
