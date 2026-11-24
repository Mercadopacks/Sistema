// Helpers de porcentaje (cálculo y formato) usados en Dashboard de Envíos y Ruta.
// Vienen de index.html (Etapa 3a de migración a ES Modules, 2026-11-24).

  export function _pct(parte, total){
    if(!total) return null;
    return Math.round((parte / total) * 1000) / 10;
  }

  export function _fmtPct(valor){
    return valor === null || Number.isNaN(valor) ? "—" : valor.toFixed(1) + "%";
  }
