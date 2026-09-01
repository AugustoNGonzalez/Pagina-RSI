// Frontend/js/UI/format.js
// Utilidades de presentación compartidas por tableUI y matrixUI: escape
// de texto, formatos numéricos y el color de las celdas de indicadores.
//
// El color NO está en el CSS porque es un gradiente continuo: cada valor
// produce un tono levemente distinto. Se calcula acá y se aplica como
// estilo inline.

/**
 * Parsea la lista de símbolos que el usuario escribe en un input. Acepta
 * cualquier mezcla de comas, punto y coma y espacios:
 *   "aapl, msft;  nvda"  →  ["AAPL", "MSFT", "NVDA"]
 *
 * Pasa a mayúsculas (los símbolos de Yahoo lo son) y deduplica, así
 * escribir el mismo ticker dos veces no dispara dos sincronizaciones.
 *
 * Está en este módulo, y no copiada en los tres lugares que la usan,
 * porque es la única puerta de entrada de símbolos tipeados a mano: si
 * mañana hay que aceptar "$AAPL" o pegar una lista de otro formato, se
 * toca acá y vale para el alta, para los grupos y para el panel.
 */
export function parseSymbols(raw) {
  return [...new Set(
    String(raw ?? "")
      .split(/[\s,;]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
  )];
}

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

// Paletas: rojo hacia arriba del neutro, verde hacia abajo. Sobre fondo
// oscuro alcanzan tintes suaves con texto claro; sobre blanco hacen
// falta colores más profundos, más alpha y texto oscuro.
const PALETTE = {
  dark:  { up: [229, 83, 75], down: [46, 204, 113], base: 0.04, span: 0.60 },
  light: { up: [201, 42, 30], down: [13, 122, 58],  base: 0.12, span: 0.66 }
};

/**
 * Color de fondo de una celda de indicador, como estilo inline.
 *
 * Sólo colorea indicadores de escala "bounded" (rango conocido, como el
 * RSI 0-100): la intensidad crece con la distancia al valor neutro. La
 * curva sqrt expande la zona media, que con alpha lineal se percibe
 * comprimida sobre fondo oscuro.
 *
 * Los indicadores sin rango fijo o categóricos se dejan sin fondo hasta
 * que se defina su propia escala.
 *
 * @param {number|string|null} value
 * @param {{scale, min?, max?, neutral?}} meta  definición del indicador
 */
export function indicatorStyle(value, meta) {
  if (typeof value !== "number" || meta?.scale !== "bounded") return "";

  const { min = 0, max = 100, neutral = 50 } = meta;
  const reach = Math.max(max - neutral, neutral - min) || 1;

  const t = Math.sqrt(Math.min(Math.abs(value - neutral) / reach, 1));
  const p = isLight() ? PALETTE.light : PALETTE.dark;
  const [r, g, b] = value >= neutral ? p.up : p.down;

  const alpha = p.base + p.span * t;
  const weight = t > 0.60 ? "font-weight:700;" : "";
  const color = isLight() ? "color:#16202b;" : (t > 0.60 ? "color:#fff;" : "");

  return `background:rgba(${r},${g},${b},${alpha.toFixed(3)});${weight}${color}`;
}

/**
 * Clase de fila para valores en zona extrema. Se aplica cuando el valor
 * recorre más del 40% de la distancia entre el neutro y cualquiera de los
 * dos extremos: con la escala del RSI (0-100, neutro 50) eso da los
 * umbrales clásicos de 70 y 30.
 */
export function zoneClass(value, meta) {
  if (typeof value !== "number" || meta?.scale !== "bounded") return "";

  const { min = 0, max = 100, neutral = 50 } = meta;

  if (value >= neutral + (max - neutral) * 0.4) return "zone-high";
  if (value <= neutral - (neutral - min) * 0.4) return "zone-low";
  return "";
}

/** Formatea el valor de un indicador según su escala. */
export function fmtIndicator(value, meta) {
  if (value == null) return "—";
  if (typeof value === "number") return value.toFixed(meta?.scale === "bounded" ? 2 : 3);
  return String(value);   // categóricos: "alcista", "bajista", etc.
}