// Dashboard de Envíos (KPIs, gráficos y tablas agregadas) de la pantalla principal.
// Viene de index.html (Etapa 3a de migración a ES Modules, 2026-11-24).
// Usa el global "lucide" cargado por CDN en index.html.
import { sb } from "../core/supabase.js";
import { tituloNombre } from "../core/formato.js";
import { fechaART } from "../core/fechas.js";
import { _pct, _fmtPct } from "../core/porcentajes.js";

  const stateEnvios = { periodo: "hoy" };

  const rangoEnviosDiv = document.getElementById("rango-envios");
  const inputRangoDesde = document.getElementById("rango-desde-envios");
  const inputRangoHasta = document.getElementById("rango-hasta-envios");

  document.querySelectorAll("#periodo-envios .chip").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#periodo-envios .chip").forEach(b=>b.classList.toggle("activo", b===btn));
      stateEnvios.periodo = btn.dataset.periodo;
      if(stateEnvios.periodo === "rango"){
        rangoEnviosDiv.hidden = false;
        if(!inputRangoDesde.value) inputRangoDesde.value = fechaART(-6);
        if(!inputRangoHasta.value) inputRangoHasta.value = fechaART(0);
      } else {
        rangoEnviosDiv.hidden = true;
      }
      cargarResumenEnvios();
    });
  });

  [inputRangoDesde, inputRangoHasta].forEach(input=>{
    input.addEventListener("change", ()=>{
      if(inputRangoDesde.value && inputRangoHasta.value) cargarResumenEnvios();
    });
  });

  // Mismos 5 periodos que el dashboard de produccion (Hoy/Ayer/7d/30d/Rango).
  function rangoFechasEnvios(){
    switch(stateEnvios.periodo){
      case "ayer": return { desde: fechaART(-1), hasta: fechaART(-1) };
      case "7d":   return { desde: fechaART(-6), hasta: fechaART(0) };
      case "30d":  return { desde: fechaART(-29), hasta: fechaART(0) };
      case "rango": return {
        desde: inputRangoDesde.value || fechaART(-6),
        hasta: inputRangoHasta.value || fechaART(0),
      };
      default: return { desde: fechaART(0), hasta: fechaART(0) }; // "hoy"
    }
  }

  // ===================== Pestañas de reporte (Entregas por hora / Cruce / Zona / Ranking) =====================
  const panelesReporte = {
    horas: document.getElementById("panel-horas"),
    cruce: document.getElementById("panel-cruce"),
    zona: document.getElementById("panel-zona"),
    ranking: document.getElementById("panel-ranking"),
  };
  document.querySelectorAll("#report-tabs-envios .chip").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#report-tabs-envios .chip").forEach(b=>b.classList.toggle("activo", b===btn));
      Object.entries(panelesReporte).forEach(([k, el])=>{ el.hidden = k !== btn.dataset.tab; });
    });
  });

  function sumaBuckets(b){ return (b.antes21||0) + (b.e21_22||0) + (b.e22_23||0) + (b.despues23||0); }
  function sumaPost21(b){ return (b.e21_22||0) + (b.e22_23||0) + (b.despues23||0); }

  const BUCKETS = [
    { key:"antes21",   corto:"Antes de las 21",  label:"Antes de las 21hs",  color:"#34c759" },
    { key:"e21_22",    corto:"21 a 22hs",         label:"21 a 22hs",          color:"#f2994a" },
    { key:"e22_23",    corto:"22 a 23hs",         label:"22 a 23hs",          color:"#ef5b5b" },
    { key:"despues23", corto:"Después de las 23", label:"Después de las 23hs", color:"#b3261e" },
  ];

  // ----- Tarjetas (mismo cálculo exacto que renderIndicadoresMeli() del dashboard de producción -----
  function renderMiniKpis(data){
    const r = data.resumen;
    const pe = data.por_estado_hora || {};
    const pef = data.por_estado_hora_flex || {};
    const vacio = { antes21:0, e21_22:0, e22_23:0, despues23:0 };
    const de = estado => pe[estado] || vacio;
    const deFlex = estado => pef[estado] || vacio;

    const entregado = de("Entregado");
    const entregado2da = de("Entregado 2DA visita");
    const reprogMeli = de("reprogramado por meli");
    const reprogComprador = de("reprogramado por comprador");

    const entregadoTotal = sumaBuckets(entregado);
    const entregado2daTotal = sumaBuckets(entregado2da);
    const efectivas = entregadoTotal + entregado2daTotal;
    const totalParaEfectividad = r.total - r.a_retirar;

    const efectivasFlex = sumaBuckets(deFlex("Entregado")) + sumaBuckets(deFlex("Entregado 2DA visita"));
    const totalParaEfectividadFlex = r.total_flex - r.a_retirar_flex;

    const correctos = entregado.antes21 || 0;
    const incorrectos = r.total - correctos;
    const reprogPost21 = sumaPost21(reprogMeli) + sumaPost21(reprogComprador);

    let demoraPost21 = 0;
    for(const [estado, b] of Object.entries(pe)){
      if(estado === "Entregado" || estado === "Entregado 2DA visita") continue;
      demoraPost21 += sumaPost21(b);
    }

    const GLOBAL = " (calculado sobre el total global del período, no se filtra por zona/chofer).";
    const tarjetas = [
      {
        label:"Entregas Efectivas", dot:"verde",
        valor:_fmtPct(_pct(efectivas, totalParaEfectividad)),
        info:'Porcentaje = (Entregado + Entregado 2DA visita) / (Total de envíos − "A retirar"). Debajo, el número de cada estado, sin restringir por hora.' + GLOBAL,
        filas:[["Entregado", entregadoTotal], ["Entregado 2DA visita", entregado2daTotal]],
        sub:{
          titulo:"Solo Flex de Mercado Libre",
          valor:_fmtPct(_pct(efectivasFlex, totalParaEfectividadFlex)),
          info:'Mismo cálculo que arriba, pero solo sobre envíos con Origen "ML" o "ML TURBO" (Flex).' + GLOBAL,
          filas:[["Entregados (flex)", efectivasFlex], ["Total flex", r.total_flex]],
        },
      },
      {
        label:"Entregas Pre 21", dot:"verde",
        valor:_fmtPct(_pct(entregado.antes21 || 0, r.total)),
        info:'Porcentaje = Entregado antes de las 21hs / Total de envíos.' + GLOBAL,
        filas:[["Entregado", entregado.antes21 || 0], ["Entregado 2DA visita", entregado2da.antes21 || 0]],
      },
      {
        label:"Entregas Post 21", dot:"amarillo",
        valor:_fmtPct(_pct(sumaPost21(entregado), r.total)),
        info:'Porcentaje = Entregado después de las 21hs / Total de envíos.' + GLOBAL,
        filas:[["Entregado", sumaPost21(entregado)], ["Entregado 2DA visita", sumaPost21(entregado2da)]],
      },
      {
        label:"Envíos Incorrectos", dot:"rojo",
        valor:_fmtPct(_pct(incorrectos, r.total)),
        info:'(Total de envíos − Envíos correctos) / Total de envíos. Incluye cualquier cosa que no sea "Entregado antes de las 21hs".' + GLOBAL,
        filas:[["Total incorrectos", incorrectos]],
      },
      {
        label:"Reprogramado Post 21", dot:"rojo",
        valor:_fmtPct(_pct(reprogPost21, r.total)),
        info:'("reprogramado por meli" + "reprogramado por comprador") después de las 21hs / Total de envíos.' + GLOBAL,
        filas:[["Reprogramado (meli + comprador)", reprogPost21]],
      },
      {
        label:"Demora", dot:"rojo",
        valor:_fmtPct(_pct(demoraPost21, r.total)),
        info:'Envíos en cualquier estado que no sea "Entregado" ni "Entregado 2DA visita", después de las 21hs / Total de envíos.' + GLOBAL,
        filas:[["Total en demora", demoraPost21]],
      },
    ];

    document.getElementById("mini-kpis").innerHTML = tarjetas.map(t => `
      <article class="mini-kpi">
        <div class="mini-label">
          <span>${t.label}</span>
          <span class="mini-info" tabindex="0" role="img" data-tip="${t.info.replace(/"/g, "&quot;")}"><i data-lucide="info"></i></span>
        </div>
        <div class="mini-value-row"><span class="mini-dot ${t.dot}"></span><span class="mini-value">${t.valor}</span></div>
        <div class="mini-sub">de ${r.total} envíos en el período</div>
        <div class="mini-detalle">
          ${t.filas.map(([label, v]) => `<div class="mini-fila"><span>${label}</span><span class="mini-fila-valor">${v} <span class="mini-fila-de">de ${r.total}</span></span></div>`).join("")}
        </div>
        ${t.sub ? `
        <div class="mini-detalle mini-sub-seccion">
          <div class="mini-label"><span>${t.sub.titulo}</span><span class="mini-info" tabindex="0" role="img" data-tip="${t.sub.info.replace(/"/g, "&quot;")}"><i data-lucide="info"></i></span></div>
          <div class="mini-value-row"><span class="mini-dot ${t.dot}"></span><span class="mini-value">${t.sub.valor}</span></div>
          <div class="mini-detalle">
            ${t.sub.filas.map(([label, v]) => `<div class="mini-fila"><span>${label}</span><span class="mini-fila-valor">${v}</span></div>`).join("")}
          </div>
        </div>` : ""}
      </article>
    `).join("");
    lucide.createIcons();
  }

  // ----- Gráfico de barras "Entregas por hora" (solo entregas efectivas, 00 a 23hs) -----
  function renderChartHoras(data, desde, hasta){
    const esUnDia = desde === hasta;
    document.getElementById("sub-chart-horas").textContent = esUnDia
      ? "Día " + hasta + " · corte a las 21:00"
      : "Suma de entregas por hora en todo el período (" + desde + " a " + hasta + ") · corte a las 21:00";

    const porHora = data.por_hora || {};
    const valores = [];
    for(let h = 0; h < 24; h++) valores.push(porHora[String(h)] || 0);
    const max = Math.max(1, ...valores);
    const colorHora = h => h < 21 ? "#34c759" : h === 21 ? "#f2994a" : h === 22 ? "#ef5b5b" : "#b3261e";

    document.getElementById("chart-horas").innerHTML = `
      <div style="display:flex; align-items:flex-end; gap:3px; height:220px;">
        ${valores.map((v, h) => `
          <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;"
               data-tip="${String(h).padStart(2,"0")}:00 — ${v} entregas">
            <span style="font-size:11px; font-weight:700; color:#333; min-height:14px; display:block;">${v > 0 ? v : ""}</span>
            <div style="width:100%; max-width:26px; height:${v > 0 ? Math.max((v/max)*180, 3) : 0}px; background:${colorHora(h)}; border-radius:3px 3px 0 0;"></div>
            <span style="font-size:11px; font-weight:700; color:#555; margin-top:4px; min-height:14px; display:block;">${String(h).padStart(2,"0")}h</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  // ----- "Cruce por hora de entrega" (todos los estados, no solo entregas) -----
  function renderCruce(data){
    const pe = data.por_estado_hora || {};
    const estados = Object.keys(pe);
    const vacio = { antes21:0, e21_22:0, e22_23:0, despues23:0 };
    const entregado = pe["Entregado"] || vacio;
    const entregado2da = pe["Entregado 2DA visita"] || vacio;
    const bEf = {};
    BUCKETS.forEach(b => { bEf[b.key] = (entregado[b.key]||0) + (entregado2da[b.key]||0); });
    const totalEf = BUCKETS.reduce((a,b)=>a+bEf[b.key], 0);

    document.getElementById("bucket-bar").innerHTML = BUCKETS.map(b => {
      const v = bEf[b.key];
      const w = totalEf ? (v/totalEf*100) : 0;
      return `<span style="width:${w}%; background:${b.color};" data-tip="${b.label}: ${v} (${_fmtPct(_pct(v,totalEf))})"></span>`;
    }).join("");

    document.getElementById("bucket-leyenda").innerHTML = BUCKETS.map(b => `
      <span><span class="dot" style="background:${b.color}"></span>${b.corto}: <strong>${bEf[b.key]}</strong> (${_fmtPct(_pct(bEf[b.key], totalEf))})</span>
    `).join("");

    const tbody = document.getElementById("tabla-cruce");
    if(!estados.length){
      tbody.innerHTML = `<tr><td colspan="6" class="sin-datos">Sin datos para este período.</td></tr>`;
      return;
    }
    const totales = { antes21:0, e21_22:0, e22_23:0, despues23:0 };
    const filas = [...estados].sort().map(estado => {
      const eb = pe[estado];
      const tot = BUCKETS.reduce((a,b)=>a+(eb[b.key]||0), 0);
      BUCKETS.forEach(b => { totales[b.key] += (eb[b.key]||0); });
      return `<tr><td>${estado}</td>${BUCKETS.map(b => `<td>${eb[b.key]||0} <span class="sin-datos">(${_fmtPct(_pct(eb[b.key]||0, tot))})</span></td>`).join("")}<td>${tot}</td></tr>`;
    }).join("");
    const granTotal = BUCKETS.reduce((a,b)=>a+totales[b.key], 0);
    tbody.innerHTML = filas + `<tr style="font-weight:700;"><td>Total</td>${BUCKETS.map(b => `<td>${totales[b.key]} <span class="sin-datos">(${_fmtPct(_pct(totales[b.key], granTotal))})</span></td>`).join("")}<td>${granTotal}</td></tr>`;
  }

  function renderZonaTabla(data){
    const tbody = document.getElementById("tabla-zona");
    if(!data.por_zona.length){
      tbody.innerHTML = `<tr><td colspan="5" class="sin-datos">Sin datos para este período.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.por_zona.map(z => `
      <tr>
        <td>${z.zona}</td>
        <td>${z.total}</td>
        <td>${_fmtPct(_pct(z.entregas_efectivas, z.total - z.a_retirar))}</td>
        <td>${_fmtPct(_pct(z.antes_de_corte, z.entregas_efectivas))}</td>
        <td>${_fmtPct(_pct(z.cancelados, z.total))}</td>
      </tr>
    `).join("");
  }

  // ----- Ranking de choferes: top 10 por defecto, buscador y "ver todos" -----
  const MIN_MUESTRA = 5; // igual que generar_reporte.py
  let mostrarTodosChoferes = false;
  let filtroChoferTexto = "";

  function renderChoferesTabla(data){
    const texto = filtroChoferTexto.toLowerCase();
    let filas = [...data.por_chofer].sort((a, b) => {
      const pa = _pct(a.entregas_efectivas, a.total_asignados - a.a_retirar) ?? -1;
      const pb = _pct(b.entregas_efectivas, b.total_asignados - b.a_retirar) ?? -1;
      return pb - pa;
    });
    if(texto) filas = filas.filter(c => c.cadete.toLowerCase().includes(texto));

    const tbody = document.getElementById("tabla-choferes");
    const btnVerMas = document.getElementById("btn-ver-mas-choferes");

    if(!filas.length){
      tbody.innerHTML = `<tr><td colspan="4" class="sin-datos">Sin resultados.</td></tr>`;
      btnVerMas.hidden = true;
      return;
    }

    const TOP = 10;
    const visibles = mostrarTodosChoferes ? filas : filas.slice(0, TOP);

    tbody.innerHTML = visibles.map(c => `
      <tr>
        <td>${tituloNombre(c.cadete)}${c.total_asignados < MIN_MUESTRA ? '<span class="tag-chica">muestra chica</span>' : ""}</td>
        <td>${c.total_asignados}</td>
        <td>${_fmtPct(_pct(c.entregas_efectivas, c.total_asignados - c.a_retirar))}</td>
        <td>${_fmtPct(_pct(c.antes_de_corte, c.entregas_efectivas))}</td>
      </tr>
    `).join("") + (!texto && data.sin_chofer_total ? `
      <tr>
        <td class="sin-datos">(sin repartidor asignado)</td>
        <td>${data.sin_chofer_total}</td>
        <td class="sin-datos">—</td>
        <td class="sin-datos">—</td>
      </tr>` : "");

    if(filas.length > TOP){
      btnVerMas.hidden = false;
      btnVerMas.textContent = mostrarTodosChoferes ? "Ver menos" : `Ver todos (${filas.length - TOP} más)`;
    } else {
      btnVerMas.hidden = true;
    }
  }

  let ultimoDataEnvios = null;

  document.getElementById("buscar-chofer").addEventListener("input", (e)=>{
    filtroChoferTexto = e.target.value;
    if(ultimoDataEnvios) renderChoferesTabla(ultimoDataEnvios);
  });
  document.getElementById("btn-ver-mas-choferes").addEventListener("click", ()=>{
    mostrarTodosChoferes = !mostrarTodosChoferes;
    if(ultimoDataEnvios) renderChoferesTabla(ultimoDataEnvios);
  });

  export async function cargarResumenEnvios(){
    const { desde, hasta } = rangoFechasEnvios();

    const { data, error } = await sb.rpc("resumen_envios", {
      fecha_desde: desde,
      fecha_hasta: hasta,
    });

    if(error){
      console.error("Error cargando resumen_envios:", error);
      document.getElementById("mini-kpis").innerHTML = `<p class="sin-datos">Error cargando los datos.</p>`;
      return;
    }

    ultimoDataEnvios = data;
    renderMiniKpis(data);
    renderChartHoras(data, desde, hasta);
    renderCruce(data);
    renderZonaTabla(data);
    renderChoferesTabla(data);
  }
