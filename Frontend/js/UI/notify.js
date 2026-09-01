// Frontend/js/UI/notify.js
// Avisos al usuario. Tres niveles, según cuánto interrumpen:
//  - overlay():  capa central bloqueante, mientras dura una descarga.
//  - progress(): píldora inferior, no bloquea; para progreso continuo.
//  - toast():    aviso centrado; "error" persiste hasta que lo cierran,
//                el resto se desvanece solo.
// Sin estado propio a nivel módulo: cada toast se lleva el suyo en el
// closure. Lo único que importa es TOAST_AUTO_MS de config.

import { TOAST_AUTO_MS } from "../config.js";

const $ = sel => document.querySelector(sel);

// ---- Overlay bloqueante ----

export function overlay(msg) {
  $("#overlay-text").textContent = msg;
  $("#overlay").classList.add("show");
}

export function overlayOff() {
  $("#overlay").classList.remove("show");
}

// ---- Progreso no bloqueante ----

export function progress(msg) {
  $("#progress-text").textContent = msg;
  $("#progress").classList.add("show");
}

export function progressOff() {
  $("#progress").classList.remove("show");
}

// ---- Toasts ----

/**
 * @param {string} msg
 * @param {"info"|"ok"|"error"} kind  "error" bloquea el fondo y espera
 *        que el usuario cierre (✕ o click afuera); el resto se va solo.
 */
export function toast(msg, kind = "info") {
  const wrap = $("#toast-wrap");

  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `
    <span class="toast-msg"></span>
    <button class="toast-close" title="Cerrar">✕</button>`;
  el.querySelector(".toast-msg").textContent = msg;  // textContent: sin riesgo de inyección

  // Handler del click en el fondo. Se guarda en una variable para poder
  // desengancharlo cuando el toast se cierra con la ✕: antes iba con
  // { once: true }, que sólo se consume si el click ocurre de verdad, así
  // que cerrando por el botón quedaba colgado y se acumulaba uno por cada
  // error mostrado en toda la sesión.
  let onWrapClick = null;

  const close = () => {
    if (el.dataset.closing) return;   // idempotente: ✕ y click de fondo pueden pisarse
    el.dataset.closing = "1";

    if (onWrapClick) {
      wrap.removeEventListener("click", onWrapClick);
      onWrapClick = null;
    }

    // El fondo se destapa recién cuando no queda NINGÚN error abierto: con
    // dos errores a la vez, cerrar uno no debe desbloquear al otro.
    if (!wrap.querySelector(".toast.error:not([data-closing])")) {
      wrap.classList.remove("blocking");
    }

    el.classList.add("hide");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    // Red de seguridad: si el toast se cierra antes de que corra el rAF de
    // entrada, no hay cambio de opacidad y transitionend nunca dispara.
    setTimeout(() => el.remove(), 400);
  };

  el.querySelector(".toast-close").addEventListener("click", close);

  if (kind === "error") {
    wrap.classList.add("blocking");
    onWrapClick = e => { if (e.target === wrap) close(); };   // sólo click FUERA del toast
    wrap.addEventListener("click", onWrapClick);
  } else {
    setTimeout(close, TOAST_AUTO_MS);
  }

  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));  // dispara la animación de entrada
}