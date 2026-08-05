// Services/timeframeService.js
// Reagrupa velas diarias en otros plazos. El cierre de una semana es el
// último cierre diario de esa semana, así que el RSI semanal sale de los
// datos que ya están guardados: no hace falta pedirle nada a Yahoo ni
// persistir una serie aparte.

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
 * Agrupa una serie diaria en velas semanales. El cierre de cada semana
 * es el de su última rueda; el epoch, el del lunes de esa semana.
 * La semana en curso se incluye con lo que haya hasta ahora, igual que
 * hace TradingView con la vela semanal abierta.
 *
 * @param {{epoch:number, close:number}[]} candles  ordenadas de vieja a nueva
 * @returns {{epoch:number, close:number}[]} serie semanal
 */
export function toWeekly(candles) {
  const byWeek = new Map();   // los Map conservan el orden de inserción

  for (const c of candles) {
    // Se pisa en cada iteración: al terminar la semana queda el último
    // cierre, que es exactamente el cierre semanal.
    byWeek.set(weekKey(c.epoch), c.close);
  }

  return [...byWeek].map(([epoch, close]) => ({ epoch, close }));
}

/**
 * Aplica el plazo pedido a una serie diaria.
 * @param {{epoch:number, close:number}[]} candles
 * @param {"1d"|"1wk"} timeframe
 */
export function applyTimeframe(candles, timeframe) {
  return timeframe === "1wk" ? toWeekly(candles) : candles;
}