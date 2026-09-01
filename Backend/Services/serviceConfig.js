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
// Años de velas diarias que se piden al dar de alta una acción nueva.
export const HISTORY_YEARS = Number(process.env.HISTORY_YEARS ?? 5);

// Días de velas horarias que se piden al cargarlas por primera vez.
// Yahoo permite hasta ~730; 250 días son ~1600 velas, muy por encima de
// lo que el suavizado de Wilder necesita para converger (con 100 alcanza)
// y todavía lejos de las cientos de miles de filas que traería pedir el
// máximo. Bajarlo a 90 (~600 velas) también sería correcto y ocuparía un
// cuarto del espacio: es la decisión que estaba escrita acá cuando el
// default todavía era 90.
export const HOURLY_HISTORY_DAYS = Number(process.env.HOURLY_HISTORY_DAYS ?? 250);

// Días extra que se piden por encima del hueco detectado al actualizar,
// como colchón contra feriados y fines de semana en los bordes del rango.
export const GAP_MARGIN_DAYS = Number(process.env.GAP_MARGIN_DAYS ?? 10);

// --- Indicadores ---
// Ventana del RSI. El proyecto trabaja con RSI 14 (el estándar que
// muestran TradingView y Yahoo).
export const RSI_PERIOD = Number(process.env.RSI_PERIOD ?? 14);