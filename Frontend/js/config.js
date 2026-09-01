// Frontend/js/config.js
// Constantes de la app: intervalos, claves de localStorage y valores por
// defecto. Todo lo que se ajusta "a mano" vive acá, no enterrado en la
// lógica.

// --- Auto-refresh ---
// La actualización se dispara al cruzar cada hora en punto, que es
// cuando cierra una vela horaria y los indicadores cambian de verdad.
export const AUTO_CHECK_MS = 20 * 1000;   // cada cuánto se evalúa si toca

// --- Avisos ---
export const TOAST_AUTO_MS = 3500;              // duración de los toasts no-error

// --- Claves de localStorage (preferencias por navegador) ---
export const SELECTED_KEY = "rsi:selected";
// OJO: index.html repite este literal en el script inline que aplica el
// tema antes de pintar. No puede importarlo (un <script type="module"> se
// difiere y llegaría tarde, que es justo lo que ese script evita), así
// que si cambia la clave hay que cambiarla en los dos lados o vuelve el
// destello de tema al cargar la página.
export const THEME_KEY = "rsi:theme";
export const ASIDE_KEY = "rsi:asideHidden";
export const TIMEFRAME_KEY = "rsi:timeframe";
export const COLUMNS_KEY = "rsi:columns";       // qué indicadores se muestran
export const MATRIX_KEY = "rsi:matrixIndicator";

// --- Plazos ---
// Los que ofrece el selector. '1h' y '1d' son velas reales de Yahoo;
// '1wk' lo deriva el backend agrupando las diarias.
export const TIMEFRAMES = [
  { id: "1h",  label: "1H", name: "por hora" },
  { id: "1d",  label: "1D", name: "diario" },
  { id: "1wk", label: "1S", name: "semanal" }
];

export const DEFAULT_TIMEFRAME = "1d";

// Indicador que arranca seleccionado, si no hay preferencia guardada.
// La lista completa la define el backend (/api/indicators/meta): el
// frontend no conoce los indicadores de antemano.
export const DEFAULT_INDICATOR = "rsi";