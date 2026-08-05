// Frontend/js/UI/notify.js
// Avisos al usuario. Tres niveles, según cuánto interrumpen:
//  - overlay():  capa central bloqueante, mientras dura una descarga.
//  - progress(): píldora inferior, no bloquea; para progreso continuo.
//  - toast():    aviso centrado; "error" persiste hasta que lo cierran,
//                el resto se desvanece solo.
// Sin estado propio ni dependencias: sólo toca el DOM.

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

  const close = () => {
    el.classList.add("hide");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  };

  const closeBtn = el.querySelector(".toast-close");
  closeBtn.addEventListener("click", close);

  if (kind === "error") {
    wrap.classList.add("blocking");
    const release = () => wrap.classList.remove("blocking");

    closeBtn.addEventListener("click", release);
    wrap.addEventListener("click", e => {
      if (e.target === wrap) { release(); close(); }   // sólo click FUERA del toast
    }, { once: true });
  } else {
    setTimeout(close, TOAST_AUTO_MS);
  }

  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));  // dispara la animación de entrada
}