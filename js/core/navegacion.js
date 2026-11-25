// Puente de navegación para cortar el ciclo de dependencia entre módulos
// de pantalla y el router (seleccionarVista, todavía en index.html) —
// los módulos llaman navegarA(v) en vez de importar seleccionarVista
// directamente (Etapa 7a de migración a ES Modules, 2026-11-25).
let navegador = null;
export function registrarNavegador(fn){ navegador = fn; }
export function navegarA(v){ if(navegador) navegador(v); }
