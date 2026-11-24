// Helpers de fechas en hora de Argentina (ART = UTC-3 fijo) usados en toda la app.
// Vienen de index.html (Etapa 3a de migración a ES Modules, 2026-11-24).

  // "Hoy"/"ayer" en hora de Argentina (ART = UTC-3 fijo, sin horario de
  // verano — mismo criterio que el resto del proyecto, ver
  // reglas_de_negocio.md), no la fecha cruda del navegador.
  export function fechaART(offsetDias){
    const ms = Date.now() - 3 * 60 * 60 * 1000 + offsetDias * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  // Pedido 2026-11-23: `envios.fecha_mercadopacks` pasó de `date` a
  // `timestamptz` (ver migración 2026-11-23_fecha_mercadopacks_con_hora.sql)
  // — estos 3 helpers arman los límites de día en ART de forma explícita
  // (mismo criterio ART = UTC-3 fijo que usa parsear_fecha() en la
  // ingesta), para no depender del timezone de sesión de Postgres al
  // filtrar por fecha ni al calcular "día ART" de un timestamp.
  export function limiteDiaART(fechaStr){ return fechaStr + "T00:00:00-03:00"; }
  export function diaSiguienteStr(fechaStr){
    const d = new Date(fechaStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  export function fechaArtDeIso(fechaISO){
    if(!fechaISO) return null;
    const ms = new Date(fechaISO).getTime() - 3 * 60 * 60 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
