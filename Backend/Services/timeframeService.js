// Services/timeframeService.js
// Reagrupa velas en plazos más largos. Sólo se guardan en la base los
// intervalos que Yahoo entrega como velas reales ('1d' y '1h'); los
// derivados se calculan acá al vuelo.
//
// Hoy el único derivado es el semanal, que sale del diario: el cierre de
// una semana ES el último cierre de esa semana, y el máximo/mínimo son
// los extremos del período. Persistirlo sería guardar dos veces el mismo
// dato, con el riesgo de que se desincronice.

const DAY = 86400;

/**
 * Epoch del lunes de la semana a la que pertenece un epoch dado. Se usa
 * como clave de agrupación: todas las velas de la misma semana caen en
 * la misma. Lunes como primer día, igual que TradingView.
 */
function weekKey(epoch) {
  const d = new Date(epoch * 1000);
  const dayOfWeek = (d.getUTCDay() + 6) % 7;   // 0=domingo → 0=lunes
  return Math.floor(epoch / DAY) * DAY - dayOfWeek * DAY;
}

/**
 * Fusiona una vela en el acumulador de su período.
 * Apertura: la de la primera vela. Cierre: la de la última.
 * Máximo/mínimo: los extremos. Volumen: la suma.
 * (No sólo el cierre: los indicadores de rango —Heikin Ashi, ATR,
 * estocástico— necesitan el OHLC agregado, no un cierre suelto.)
 */
function merge(acc, c) {
  if (!acc) {
    return {
      epoch: c.epoch,          // se pisa abajo con la clave del período
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0
    };
  }

  if (c.high != null) acc.high = acc.high == null ? c.high : Math.max(acc.high, c.high);
  if (c.low != null)  acc.low  = acc.low  == null ? c.low  : Math.min(acc.low, c.low);
  acc.close = c.close;                       // la última vela manda
  acc.volume = (acc.volume ?? 0) + (c.volume ?? 0);

  return acc;
}

/**
 * Agrupa una serie diaria en velas semanales completas (OHLCV).
 * La semana en curso se incluye con lo que haya hasta ahora, igual que
 * hace TradingView con la vela semanal abierta.
 *
 * @param {Array<{epoch, open, high, low, close, volume}>} candles
 *        ordenadas de más vieja a más nueva
 * @returns {Array<{epoch, open, high, low, close, volume}>} serie semanal
 */
function toWeekly(candles) {
  const byWeek = new Map();   // los Map conservan el orden de inserción

  for (const c of candles) {
    const key = weekKey(c.epoch);
    byWeek.set(key, merge(byWeek.get(key), c));
  }

  // El epoch de cada vela semanal es el del lunes de su semana
  return [...byWeek].map(([epoch, candle]) => ({ ...candle, epoch }));
}

/**
 * Aplica el plazo pedido a una serie de velas.
 * '1d' y '1h' se devuelven tal cual: ya vienen de la base en esa
 * granularidad. '1wk' se deriva agrupando las diarias.
 *
 * @param {Array} candles
 * @param {"1d"|"1h"|"1wk"} timeframe
 */
export function applyTimeframe(candles, timeframe) {
  return timeframe === "1wk" ? toWeekly(candles) : candles;
}

/**
 * Qué intervalo hay que leer de la base para servir un plazo.
 * El semanal se deriva del diario, así que ambos leen '1d'.
 * @param {"1d"|"1h"|"1wk"} timeframe
 * @returns {"1d"|"1h"}
 */
export function baseInterval(timeframe) {
  return timeframe === "1h" ? "1h" : "1d";
}