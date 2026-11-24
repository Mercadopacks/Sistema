// Modal de aviso/confirmación genérico, usado en toda la app en vez de
// alert()/confirm() nativos.
// Viene de index.html (Etapa 1 de migración a ES Modules, 2026-11-24).

// Reemplaza mostrarAviso()/mostrarConfirmacion() nativos (que muestran el nombre del host
// y rompen el diseño) por el mismo modal-overlay usado en el resto del
// sistema. mostrarAviso devuelve siempre; mostrarConfirmacion devuelve
// una Promise<boolean> para poder hacer `if(await mostrarConfirmacion(...))`.
const modalAviso = document.getElementById("modal-aviso");
const modalAvisoTexto = document.getElementById("modal-aviso-texto");
const modalAvisoAceptar = document.getElementById("modal-aviso-aceptar");
const modalAvisoCancelar = document.getElementById("modal-aviso-cancelar");

export function mostrarAviso(texto){
  modalAvisoTexto.textContent = texto;
  modalAvisoCancelar.hidden = true;
  modalAviso.hidden = false;
  return new Promise(resolve=>{
    function cerrar(){ modalAviso.hidden = true; modalAvisoAceptar.removeEventListener("click", cerrar); resolve(); }
    modalAvisoAceptar.addEventListener("click", cerrar);
  });
}

export function mostrarConfirmacion(texto){
  modalAvisoTexto.textContent = texto;
  modalAvisoCancelar.hidden = false;
  modalAviso.hidden = false;
  return new Promise(resolve=>{
    function terminar(resultado){
      modalAviso.hidden = true;
      modalAvisoAceptar.removeEventListener("click", onAceptar);
      modalAvisoCancelar.removeEventListener("click", onCancelar);
      resolve(resultado);
    }
    function onAceptar(){ terminar(true); }
    function onCancelar(){ terminar(false); }
    modalAvisoAceptar.addEventListener("click", onAceptar);
    modalAvisoCancelar.addEventListener("click", onCancelar);
  });
}
