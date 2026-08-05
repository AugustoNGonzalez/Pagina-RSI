// Services/marketDataService.js
// Capa que habla con Yahoo Finance (vía yahoo-finance2) y devuelve las
// velas diarias ya en un formato simple, sin que nadie más en la app
// tenga que conocer el shape de la librería.

import YahooFinance from "yahoo-finance2";
import { RATE_LIMIT_MS, MAX_RETRIES } from "./serviceConfig.js";

const yf = new YahooFinance();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toUnix = d => Math.floor(d.getTime() / 1000);

// Normaliza a epoch (segundos) un valor que puede venir como número o
// como Date, según la versión de yahoo-finance2 y el modo de retorno.
const asEpoch = v => {
  if (v == null) return null;
  if (v instanceof Date) return toUnix(v);
  return Number(v);
};

// Errores determinísticos: reintentar no va a cambiar el resultado, se
// propagan de inmediato (ej: símbolo inexistente, request malformada).
// Los transitorios (rate limit 429, timeouts, cortes de red, 5xx) sí se
// reintentan con backoff.
function isNonRetryable(err) {
  const msg = (err?.message ?? "").toLowerCase();
  const status = err?.response?.status ?? err?.status;

  if (status === 404 || status === 400) return true;
  if (msg.includes("not found")) return true;
  if (msg.includes("delisted")) return true;
  if (msg.includes("no data")) return true;

  return false;
}

/**
 * Trae las velas diarias de una acción entre dos fechas, junto con la
 * cotización viva y los límites de la sesión actual (necesarios para
 * separar velas completadas de la vela en curso del día).
 *
 * Reintenta con backoff exponencial ante errores transitorios hasta
 * MAX_RETRIES veces; los errores determinísticos (símbolo inválido)
 * se propagan al primer intento.
 *
 * @param {string} symbol  Ticker, ej: "AAPL"
 * @param {Date} from      Desde cuándo
 * @param {Date} to        Hasta cuándo
 * @returns {Promise<{
 *   meta: { symbol, exchange, currency, instrumentType, longName, shortName,
 *           regularMarketPrice, regularMarketTime, previousClose,
 *           regularSessionStart },
 *   candles: Array<{ epoch, open, high, low, close, volume }>
 * }>}
 */
export async function fetchDailyCandles(symbol, from, to) {
  const period1 = toUnix(from);
  const period2 = toUnix(to);

  let attempt = 0;

  // El loop sale por return (éxito) o por throw (error no reintentable,
  // o reintentos agotados); nunca itera de más.
  while (true) {
    try {
      // `return: "object"` hace que la respuesta traiga meta/timestamp/
      // indicators directo en la raíz del objeto devuelto (no hay que
      // buscar chart.result[0] como en el JSON crudo del endpoint REST).
      const res = await yf.chart(symbol, {
        period1,
        period2,
        interval: "1d",
        includePrePost: false,
        return: "object"
      });

      if (!res) throw new Error("Yahoo Finance response inválida");

      const ts = res.timestamp ?? [];               // epochs, uno por vela
      const q = res.indicators?.quote?.[0] ?? {};   // arrays paralelos: open[], high[], low[], close[], volume[]

      const candles = [];

      for (let i = 0; i < ts.length; i++) {
        // Sin cierre para esa posición, la vela no sirve (día sin dato)
        if (q.close?.[i] == null) continue;

        candles.push({
          epoch: ts[i],
          open: q.open?.[i] ?? null,
          high: q.high?.[i] ?? null,
          low: q.low?.[i] ?? null,
          close: q.close[i],
          volume: q.volume?.[i] ?? null
        });
      }

      return {
        meta: {
          symbol: res.meta?.symbol ?? symbol,
          exchange: res.meta?.exchangeName ?? null,
          currency: res.meta?.currency ?? null,           // reservado: hoy no se lee
          instrumentType: res.meta?.instrumentType ?? null, // reservado: hoy no se lee
          longName: res.meta?.longName ?? null,
          shortName: res.meta?.shortName ?? null,

          // Cotización viva: alimenta StockLastQuote en cada sync
          regularMarketPrice: res.meta?.regularMarketPrice ?? null,
          regularMarketTime: asEpoch(res.meta?.regularMarketTime),
          previousClose: res.meta?.previousClose ?? null,

          // Inicio de la sesión de hoy: toda vela con epoch >= este valor
          // es la vela EN CURSO (parcial, epoch inestable) y no debe
          // persistirse en StockPrices. La separación la hace syncService.
          regularSessionStart: asEpoch(res.meta?.currentTradingPeriod?.regular?.start)
        },
        candles
      };

    } catch (err) {
      if (isNonRetryable(err)) {
        console.error(`[YahooFetchError] symbol=${symbol} error no reintentable`, err);
        throw err;
      }

      attempt++;

      console.error(
        `[YahooFetchError] symbol=${symbol} attempt=${attempt}/${MAX_RETRIES} ` +
        `from=${from.toISOString()} to=${to.toISOString()}`,
        err
      );

      // Se agotaron los reintentos: se propaga el error para que lo
      // maneje quien llamó (syncService).
      if (attempt >= MAX_RETRIES) {
        throw err;
      }

      // Backoff exponencial: 1200ms, 2400ms, 4800ms... antes del próximo intento
      const backoffMs = RATE_LIMIT_MS * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    }
  }
}