// Services/ratioService.js
// Matriz de RSI de ratios: para cada par (A, B) calcula el RSI de la
// serie sintética A/B (precio de A dividido precio de B, vela a vela).
// Es lo que muestra TradingView si se escribe "AAPL/MSFT" y se le pone
// un RSI encima, así que los valores son validables contra esa fuente.
//
// NO es antisimétrica: RSI(B/A) no es 100 − RSI(A/B), porque la inversa
// 1/x deforma los deltas de forma no lineal. Por eso se calcula el RSI
// de las dos direcciones y la matriz sale completa, no medio triángulo.
// Lo que SÍ se comparte entre las dos direcciones es la intersección de
// fechas, que es la parte cara.

import { calculateRSI } from "./rsiService.js";
import { applyTimeframe } from "./timeframeService.js";

/**
 * Serie del ratio entre dos acciones, intersectando por epoch: sólo las
 * fechas en que AMBAS cotizaron. Cubre feriados distintos entre bolsas y
 * acciones que empezaron a cotizar después.
 *
 * @param {Map<number, number>} a  epoch → cierre de la acción A
 * @param {Map<number, number>} b  epoch → cierre de la acción B
 * @returns {{epoch:number, close:number}[]} serie A/B, de más vieja a más nueva
 */
function ratioSeries(a, b) {
  const series = [];

  // Se recorre el más chico y se busca en el más grande: el costo lo
  // marca la intersección, no el histórico completo del más largo.
  const [small, big, invert] = a.size <= b.size ? [a, b, false] : [b, a, true];

  for (const [epoch, price] of small) {
    const other = big.get(epoch);
    if (other == null || other === 0 || price === 0) continue;
    series.push({
      epoch,
      close: invert ? other / price : price / other
    });
  }

  series.sort((x, y) => x.epoch - y.epoch);
  return series;
}

/**
 * RSI del último punto de una serie, en el plazo pedido. La agregación
 * se hace sobre la serie del ratio ya intersectada, no sobre los precios
 * por separado: el ratio semanal es el cociente del último día de cada
 * semana, que es lo que muestra TradingView.
 */
function lastRSI(series, period, timeframe) {
  const s = applyTimeframe(series, timeframe);
  if (s.length < period + 1) return null;
  return calculateRSI(s, period).at(-1)?.rsi ?? null;
}

/**
 * Matriz N×N de RSI de ratios. Sólo se intersecta una vez por par: la
 * serie B/A es la inversa punto a punto de A/B, así que se deriva con
 * 1/close en vez de recorrer los Maps de nuevo.
 *
 * @param {Array<{symbol:string, closes:Map<number,number>}>} stocks
 * @param {number} period
 * @param {"1d"|"1wk"} timeframe
 * @returns {{rows: Array<{symbol, cells: Array<{symbol, rsi, points}>}>}}
 *          rsi es null en la diagonal y si el par no tiene suficientes
 *          velas en común; points informa cuántas se usaron (siempre en
 *          días, es la medida de solapamiento entre las dos acciones).
 */
export function buildRatioMatrix(stocks, period = 14, timeframe = "1d") {
  const n = stocks.length;

  // Matriz vacía; se va llenando de a pares
  const cells = stocks.map(row =>
    stocks.map(col => ({ symbol: col.symbol, rsi: null, points: 0 }))
  );

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {          // sólo la mitad superior
      const direct = ratioSeries(stocks[i].closes, stocks[j].closes);
      const points = direct.length;

      // La dirección opuesta es la misma serie invertida: mismos epochs,
      // cierres recíprocos. Evita repetir la intersección.
      const inverse = direct.map(p => ({ epoch: p.epoch, close: 1 / p.close }));

      cells[i][j] = { symbol: stocks[j].symbol, rsi: lastRSI(direct, period, timeframe), points };
      cells[j][i] = { symbol: stocks[i].symbol, rsi: lastRSI(inverse, period, timeframe), points };
    }
  }

  return {
    rows: stocks.map((s, i) => ({ symbol: s.symbol, cells: cells[i] }))
  };
}