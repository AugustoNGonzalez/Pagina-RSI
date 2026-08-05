// Frontend/js/UI/format.js
// Utilidades de presentación compartidas por tableUI y matrixUI. Estaban
// duplicadas en ambos: tocar el gradiente en un lado y olvidarse del
// otro ya causó inconsistencias, así que viven acá una sola vez.

import { RSI_OVERBOUGHT, RSI_OVERSOLD } from "../config.js";

/** Escapa texto para inyectar seguro en innerHTML (los nombres de
 *  empresa vienen de Yahoo, son texto libre). */
export const esc = s => String(s ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Número con decimales fijos, o guión si no hay dato. */
export const fmt = (v, dec = 2) => (typeof v === "number" ? v.toFixed(dec) : "—");

/** Hora de última actualización; si no es de hoy muestra la fecha, para
 *  que "15:32" no se confunda con algo fresco cuando es de ayer. */
export function fmtUpdated(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";

  const now = new Date();
  const sameDay = d.getDate() === now.getDate() &&
                  d.getMonth() === now.getMonth() &&
                  d.getFullYear() === now.getFullYear();

  return sameDay
    ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

const isLight = () => document.documentElement.dataset.theme === "light";

/**
 * Gradiente continuo del RSI, como estilo inline.
 * Neutro en 50; hacia 100 rojo (sobrecompra), hacia 0 verde (sobreventa).
 * La curva sqrt expande la zona media, que con alpha lineal se percibe
 * comprimida. La paleta depende del tema: sobre fondo oscuro alcanzan
 * tintes suaves con texto claro; sobre blanco hacen falta colores más
 * profundos, más alpha y texto oscuro.
 */
export function rsiStyle(rsi) {
  if (typeof rsi !== "number") return "";

  const t = Math.sqrt(Math.min(Math.abs(rsi - 50) / 50, 1));
  const light = isLight();
  const high = rsi >= 50;

  const [r, g, b] = light
    ? (high ? [201, 42, 30] : [13, 122, 58])
    : (high ? [229, 83, 75] : [46, 204, 113]);

  const alpha = light ? 0.12 + 0.66 * t : 0.04 + 0.60 * t;
  const weight = t > 0.60 ? "font-weight:700;" : "";
  const color = light ? "color:#16202b;" : (t > 0.60 ? "color:#fff;" : "");

  return `background:rgba(${r},${g},${b},${alpha.toFixed(3)});${weight}${color}`;
}

/** Clase de fila para zonas extremas del RSI (resalta la fila entera). */
export function zoneClass(rsi) {
  if (typeof rsi !== "number") return "";
  if (rsi >= RSI_OVERBOUGHT) return "zone-high";
  if (rsi <= RSI_OVERSOLD) return "zone-low";
  return "";
}