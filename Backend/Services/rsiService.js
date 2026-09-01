// Services/rsiService.js
// Cálculo puro del RSI (no toca la base ni la red). Recibe un array de
// velas ordenadas por fecha y devuelve el mismo array con un campo `rsi`
// agregado en cada una.
// Es agnóstico del plazo: la misma función sirve para velas diarias,
// semanales u horarias, y para series sintéticas como los ratios A/B.
/**
 * RSI de Wilder (el estándar, el que muestran TradingView/Yahoo).
 * El primer promedio de ganancias/pérdidas es una SMA de los primeros
 * `period` deltas; de ahí en adelante se usa el suavizado de Wilder:
 *   avg = (avgAnterior * (period - 1) + valorActual) / period
 * Es recursivo: cada RSI depende de toda la historia previa, por lo que
 * conviene alimentarlo con bastante más historial que `period` velas
 * (100+ para que converja al valor "oficial").
 *
 * @param {{close:number}[]} candles  Velas ordenadas de más vieja a más nueva
 * @param {number} period             Ventana del suavizado (default 14)
 * @returns {Array<{close:number, rsi:number|null}>} mismas velas con el
 *          campo `rsi` agregado (null mientras no haya suficiente
 *          historial para el primer promedio)*/
export function calculateRSI(candles, period = 14) {
  if (!Array.isArray(candles)) {
    throw new Error("candles debe ser un array");
  }

  // Hace falta period+1 cierres para tener los primeros `period` deltas
  if (candles.length < period + 1) {
    return candles.map(c => ({ ...c, rsi: null }));
  }

  const result = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < candles.length; i++) {
    // La primera vela no tiene delta (no hay vela anterior)
    if (i === 0) {
      result.push({ ...candles[i], rsi: null });
      continue;
    }

    const delta = candles[i].close - candles[i - 1].close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;

    if (i < period) {
      // Todavía acumulando los primeros `period` deltas para la SMA inicial
      avgGain += gain;
      avgLoss += loss;
      result.push({ ...candles[i], rsi: null });
      continue;
    }

    if (i === period) {
      // SMA inicial: promedio simple de los primeros `period` deltas
      avgGain = (avgGain + gain) / period;
      avgLoss = (avgLoss + loss) / period;
    } else {
      // Suavizado de Wilder: el promedio nuevo arrastra al anterior
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    let rsi;
    // Serie plana: ni ganancias ni pérdidas en la ventana efectiva. El
    // RSI es 0/0, indefinido; se devuelve el neutro porque no hay sesgo
    // direccional alguno. Sin este caso caía por avgLoss === 0 y daba
    // 100 ("máximo sobrecomprado") para algo que no se movió: pasa con
    // papeles congelados y, sobre todo, con ratios entre dos símbolos
    // que se mueven idéntico (doble listado, ADR contra su local).
    if (avgGain === 0 && avgLoss === 0) rsi = 50;
    else if (avgLoss === 0) rsi = 100;  // solo subas en la ventana efectiva
    else if (avgGain === 0) rsi = 0;    // solo bajas
    else {
      const rs = avgGain / avgLoss;
      rsi = 100 - 100 / (1 + rs);
    }

    result.push({ ...candles[i], rsi: Number(rsi.toFixed(2)) });
  }

  return result;
}