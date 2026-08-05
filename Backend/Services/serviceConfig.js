// Services/serviceConfig.js
// Configuración centralizada de los Services. Todo sale de variables de
// entorno, con un default razonable si no están seteadas: para cambiar
// cualquiera de estos valores no hace falta tocar código, alcanza con
// el .env.

// --- Yahoo Finance ---
// Pausa base entre requests. Se usa para dos cosas: separar los símbolos
// en syncMany (para no gatillar el rate limit de Yahoo) y como base del
// backoff exponencial entre reintentos (1200ms, 2400ms, 4800ms...).
export const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS ?? 1200);

// Reintentos máximos por fetch ante errores transitorios. Los errores
// determinísticos (símbolo inexistente) no reintentan nunca.
export const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 5);

// --- Histórico ---
// Cuántos años se piden al dar de alta una acción nueva. En las
// actualizaciones NO se usa: ahí manda la ventana adaptativa de abajo.
export const HISTORY_YEARS = Number(process.env.HISTORY_YEARS ?? 5);

// Ventana mínima al actualizar una acción ya cargada. Tiene que ser lo
// bastante amplia para que el suavizado de Wilder converja (con 400 días
// el error es del orden de 10⁻⁹); si el hueco desde la última vela
// guardada es mayor, se usa ese hueco.
export const UPDATE_WINDOW_DAYS = Number(process.env.UPDATE_WINDOW_DAYS ?? 400);

// Días extra que se piden por encima del hueco detectado, como colchón
// contra feriados y fines de semana en los bordes del rango.
export const GAP_MARGIN_DAYS = Number(process.env.GAP_MARGIN_DAYS ?? 10);

// --- Indicadores ---
// Ventana del RSI. El proyecto trabaja con RSI 14 (el estándar que
// muestran TradingView y Yahoo).
export const RSI_PERIOD = Number(process.env.RSI_PERIOD ?? 14);

// Plazos soportados por el selector del frontend. "1h" todavía no está
// implementado en el backend (necesita fetch propio y schema
// multi-intervalo); "1d" y "1wk" se derivan de las velas diarias.
export const TIMEFRAMES = ["1h", "1d", "1wk"];