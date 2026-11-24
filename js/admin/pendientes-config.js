// Estado global del aviso de "pendientes" (choferes/localidades) que
// muestra el sidebar en Configuración.
// Viene de index.html (Etapa 2 de migración a ES Modules, 2026-11-24).

  // Pedido 2026-11-23: el sidebar ya NO muestra números sueltos para
  // "Configuración" (antes se veían 2 badges numéricos pegados, ruidoso) —
  // un solo ícono de alerta avisa que hay algo pendiente en alguna
  // sub-sección, sin decir cuánto. El número exacto sigue viéndose en el
  // sub-ítem puntual (Repartidores/Localidades) una vez adentro, que es
  // donde sí es útil saber cuántos hay.
  export const pendientesConfigState = { choferes: 0, localidades: 0 };
  export function actualizarIconoPendientesConfig(){
    const total = pendientesConfigState.choferes + pendientesConfigState.localidades;
    document.getElementById("icono-pendientes-config").hidden = total === 0;
  }
