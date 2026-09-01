// Services/ratioService.js
// Matriz de indicadores sobre ratios: para cada par (A, B) calcula el
// indicador elegido sobre la serie sintética A/B (precio de A dividido
// precio de B, vela a vela).
// Es lo que muestra TradingView si se escribe "AAPL/MSFT" y se le pone
// el indicador encima, así que los valores son validables contra esa
// fuente.
//
// NO es antisimétrica: el indicador de B/A no es el complemento del de
// A/B, porque la inversa 1/x deforma los deltas de forma no lineal. Por
// eso se calculan las dos direcciones. Lo que SÍ se comparte entre ellas
// es la intersección de fechas, que es la parte cara.

import { computeOne } from "./indicatorService.js";

/**
 * Serie del ratio entre dos acciones, intersectando por epoch: sólo las
 * fechas en que AMBAS cotizaron. Cubre feriados distintos entre bolsas,
 * acciones que empezaron a cotizar después y huecos de datos.
 *
 * El OHLC del ratio se arma dividiendo campo a campo. No es exactamente
 * el máximo/mínimo del cociente dentro del período (para eso harían
 * falta datos intradía), pero es la aproximación estándar y la que usan
 * las plataformas para símbolos compuestos.
 *
 * @param {Map<number, object>} a  epoch → vela de la acción A
 * @param {Map<number, object>} b  epoch → vela de la acción B
 * @returns {Array<{epoch, open, high, low, close, volume}>} serie A/B,
 *          de más vieja a más nueva
 */
function ratioSeries(a, b) {
  const series = [];

  // Se recorre el más chico y se busca en el más grande: el costo lo
  // marca la intersección, no el histórico completo del más largo.
  const [small, big, invert] = a.size <= b.size ? [a, b, false] : [b, a, true];

  const div = (x, y) => (x == null || y == null || y === 0 ? null : x / y);

  for (const [epoch, candle] of small) {
    const other = big.get(epoch);
    if (!other) continue;

    const [num, den] = invert ? [other, candle] : [candle, other];
    const close = div(num.close, den.close);
    if (close == null) continue;   // sin cierre no hay vela útil

    series.push({
      epoch,
      open: div(num.open, den.open),
      high: div(num.high, den.high),
      low: div(num.low, den.low),
      close,
      volume: null                 // el volumen de un ratio no significa nada
    });
  }

  series.sort((x, y) => x.epoch - y.epoch);
  return series;
}

/** Invierte una serie de ratio: mismos epochs, valores recíprocos. */
function invertSeries(series) {
  const inv = v => (v == null || v === 0 ? null : 1 / v);

  return series.map(p => ({
    epoch: p.epoch,
    open: inv(p.open),
    // Al invertir, el máximo pasa a ser el mínimo y viceversa
    high: inv(p.low),
    low: inv(p.high),
    close: inv(p.close),
    volume: null
  }));
}

/**
 * Matriz N×N del indicador elegido sobre los ratios. Sólo se intersecta
 * una vez por par: la serie B/A se deriva invirtiendo A/B en vez de
 * recorrer los Maps de nuevo.
 *
 * @param {Array<{symbol:string, candles:Map<number,object>}>} stocks
 * @param {string} indicatorId
 * @param {"1d"|"1h"|"1wk"} timeframe
 * @returns {{rows: Array<{symbol, cells: Array<{symbol, value, points}>}>}}
 *          value es null en la diagonal y si el par no tiene suficientes
 *          velas en común; points informa cuántas se usaron (en la
 *          granularidad base, es la medida de solapamiento real).
 */
export function buildRatioMatrix(stocks, indicatorId, timeframe = "1d") {
  const n = stocks.length;

  // Matriz vacía; se va llenando de a pares
  const cells = stocks.map(() =>
    stocks.map(col => ({ symbol: col.symbol, value: null, points: 0 }))
  );

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {          // sólo la mitad superior
      const direct = ratioSeries(stocks[i].candles, stocks[j].candles);
      const points = direct.length;
      const inverse = invertSeries(direct);

      cells[i][j] = {
        symbol: stocks[j].symbol,
        value: computeOne(indicatorId, direct, timeframe),
        points
      };
      cells[j][i] = {
        symbol: stocks[i].symbol,
        value: computeOne(indicatorId, inverse, timeframe),
        points
      };
    }
  }

  return {
    rows: stocks.map((s, i) => ({ symbol: s.symbol, cells: cells[i] }))
  };
}