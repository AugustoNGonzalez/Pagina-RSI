// Frontend/js/UI/theme.js
// Preferencias visuales guardadas por navegador: tema claro/oscuro y
// aside colapsado. Ambas persisten en localStorage, así cada usuario
// (la app se comparte en red) conserva su propia vista.

import { THEME_KEY, ASIDE_KEY } from "../config.js";

const $ = sel => document.querySelector(sel);

// ---- Tema ----

export function applyTheme(theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;

  localStorage.setItem(THEME_KEY, theme);
  const btn = $("#theme-btn");
  btn.textContent = theme === "light" ? "☀" : "☾";
  btn.title = theme === "light" ? "Cambiar a modo oscuro" : "Cambiar a modo claro";
}

/** Tema guardado ("dark" si no hay nada). El index.html ya lo aplicó al
 *  <html> antes de pintar; acá se re-aplica para actualizar el botón. */
export function savedTheme() {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

/** Alterna el tema y devuelve el nuevo. Ojo: quien llame TIENE que
 *  repintar después (los gradientes de las celdas son estilos inline y no
 *  cambian solos al cambiar el tema). Hoy app.js lo hace llamando a
 *  render() y descarta el valor devuelto. */
export function toggleTheme() {
  const next = savedTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

// ---- Aside colapsable ----

export function applyAside(hidden) {
  document.body.classList.toggle("aside-hidden", hidden);
  $("#aside-toggle").title = hidden ? "Mostrar panel" : "Ocultar panel";
  localStorage.setItem(ASIDE_KEY, hidden ? "1" : "0");
}

export function savedAsideHidden() {
  return localStorage.getItem(ASIDE_KEY) === "1";
}

export function toggleAside() {
  applyAside(!document.body.classList.contains("aside-hidden"));
}