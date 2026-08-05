// Frontend/js/config.js
// Constantes de la app: intervalos, claves de localStorage y umbrales.
// Todo lo que se ajusta "a mano" vive acá, no enterrado en la lógica.

// --- Auto-refresh ---
export const AUTO_REFRESH_MS = 12 * 60 * 1000;  // tiempo mínimo entre actualizaciones
export const AUTO_CHECK_MS = 30 * 1000;         // cada cuánto se evalúa si toca

// --- Avisos ---
export const TOAST_AUTO_MS = 3500;              // duración de los toasts no-error

// --- Claves de localStorage (preferencias por navegador) ---
export const SELECTED_KEY = "rsi:selected";
export const THEME_KEY = "rsi:theme";
export const ASIDE_KEY = "rsi:asideHidden";

// --- Umbrales del RSI ---
export const RSI_OVERBOUGHT = 70;               // resalta la fila en rojo
export const RSI_OVERSOLD = 30;                 // resalta la fila en verde

export const TIMEFRAME_KEY = "rsi:timeframe";
export const DEFAULT_TIMEFRAME = "1d";