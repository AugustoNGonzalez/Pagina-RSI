// Services/syncService.js
// Orquesta la sincronización de una acción: pide velas a Yahoo, la da de
// alta si es nueva, guarda las velas completadas que falten y actualiza
// la cotización viva.
//
// NO calcula indicadores. Antes devolvía el RSI del momento calculado
// sobre las velas del fetch, lo que obligaba a bajar cientos de velas en
// cada refresco para que Wilder convergiera. Ahora los indicadores se
// piden aparte (indicatorService), leyendo la serie completa de la base
// y agregándole la vela en curso: el fetch sólo tiene que traer el hueco.

import { fetchCandles } from "./marketDataService.js";
import { getLastEpoch, persistCandlesBulk, upsertLastQuote } from "./priceService.js";
import { getOrCreateStock, findStockBySymbol } from "./stockService.js";
import {
  HISTORY_YEARS, HOURLY_HISTORY_DAYS, GAP_MARGIN_DAYS, RATE_LIMIT_MS
} from "./serviceConfig.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const HOUR = 3600;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Separa las velas COMPLETADAS de la vela EN CURSO.
 *
 * Diario: está en curso la vela cuyo epoch cae en o después del inicio
 * de la sesión regular de hoy (meta.regularSessionStart). Fallback si
 * Yahoo no lo trae: el inicio del día UTC.
 *
 * Horario: está en curso la vela de la hora actual, o sea la que empieza
 * dentro de la hora en la que estamos.
 *
 * La vela en curso tiene epoch inestable (cambia entre fetches) y su
 * cierre es parcial: NUNCA se persiste. Se devuelve aparte para que
 * quien la necesite (el cálculo de indicadores) la use en memoria.
 */
function splitCandles(candles, meta, interval) {
  let cutoff;

  if (interval === "1h") {
    cutoff = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  } else {
    cutoff = meta.regularSessionStart;
    if (cutoff == null) {
      const now = new Date();
      cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
    }
  }

  const completed = candles.filter(c => c.epoch < cutoff);
  const current = candles.find(c => c.epoch >= cutoff) ?? null;

  return { completed, current };
}

/**
 * Cuántos días de histórico pedirle a Yahoo.
 * Acción nueva (o hueco enorme): el histórico completo del intervalo.
 * Actualización: sólo el hueco desde la última vela guardada, más un
 * margen por feriados y fines de semana en los bordes.
 */
function windowDays(interval, lastEpoch) {
  const fullDays = interval === "1h"
    ? HOURLY_HISTORY_DAYS
    : Math.round(HISTORY_YEARS * 365);

  if (lastEpoch == null) return fullDays;

  const gapDays = Math.ceil((Date.now() / 1000 - lastEpoch) / 86400);
  return Math.min(fullDays, gapDays + GAP_MARGIN_DAYS);
}

/**
 * Sincroniza una acción en un intervalo. Sirve tanto para darla de alta
 * como para actualizarla: es el mismo flujo, y el filtro por lastEpoch
 * decide cuánto de lo que llegó es realmente nuevo.
 *
 * @param {string} symbol
 * @param {"1d"|"1h"} interval  qué granularidad sincronizar
 * @returns {Promise<{
 *   stockId, symbol, interval,
 *   mode: "initial"|"update",
 *   inserted: number,            // velas completadas nuevas persistidas
 *   live: { price, previousClose, epoch }   // cotización del momento
 * }>}
 */
export async function syncStock(symbol, interval = "1d") {
  // `to` un día en el futuro: garantiza que la vela en curso entre al rango
  const to = new Date(Date.now() + ONE_DAY_MS);

  try {
    const existingId = await findStockBySymbol(symbol);
    let lastEpoch = existingId != null ? await getLastEpoch(existingId, interval) : null;

    const from = new Date(Date.now() - windowDays(interval, lastEpoch) * ONE_DAY_MS);

    const { meta, candles } = await fetchCandles(symbol, interval, from, to);

    const stockId = await getOrCreateStock(meta);

    // Yahoo puede normalizar el símbolo: si terminó en otra fila, el
    // lastEpoch que leímos antes no corresponde y hay que releerlo.
    if (stockId !== existingId) lastEpoch = await getLastEpoch(stockId, interval);

    // Paso clave 1: la vela en curso se aparta, jamás llega a la base
    const { completed, current } = splitCandles(candles, meta, interval);

    // Paso clave 2: filtro explícito en JS contra lo ya guardado. No se
    // confía en los bordes de period1/period2 de Yahoo (son difusos).
    const newCandles = lastEpoch == null
      ? completed
      : completed.filter(c => c.epoch > lastEpoch);

    const inserted = await persistCandlesBulk(stockId, interval, newCandles);

    // Cotización viva a StockLastQuote (única tabla que se pisa siempre).
    // Se escribe en TODOS los intervalos, no sólo en el diario. Es
    // deliberado: cuando el usuario está en el plazo 1H el frontend
    // sincroniza únicamente '1h' (ver intervalFor en actions/stocks.js),
    // así que un guard por interval === "1d" dejaría el precio congelado
    // en horario. La escritura repetida cuesta un UPDATE de una fila y el
    // valor es el mismo en los dos casos: sale del meta, no de las velas.
    const livePrice = meta.regularMarketPrice ?? current?.close ?? completed.at(-1)?.close ?? null;
    const liveEpoch = meta.regularMarketTime ?? current?.epoch ?? completed.at(-1)?.epoch ?? null;

    // previousClose: Yahoo sólo lo incluye en el meta para intervalos
    // intradía; con interval=1d viene ausente. Se deriva de las velas:
    // con vela en curso, el cierre previo es la última completada (ayer);
    // sin vela en curso, la última completada ES la cotización actual y
    // el previo es la anteúltima. (chartPreviousClose NO sirve: es el
    // cierre anterior al inicio del rango pedido.)
    const prevClose = meta.previousClose
      ?? (current ? completed.at(-1)?.close : completed.at(-2)?.close)
      ?? null;

    if (livePrice != null && liveEpoch != null) {
      await upsertLastQuote(stockId, {
        lastPrice: livePrice,
        previousClose: prevClose,
        lastEpoch: liveEpoch
      });
    }

    return {
      stockId,
      symbol: meta.symbol,
      interval,
      mode: lastEpoch == null ? "initial" : "update",
      inserted,
      live: {
        price: livePrice,
        previousClose: prevClose,
        epoch: liveEpoch
      }
    };

  } catch (err) {
    console.error(`[syncService][syncStock] symbol=${symbol} interval=${interval}`, err);
    throw err;
  }
}

/**
 * Sincroniza varias acciones EN SERIE (nunca en paralelo: evita tanto el
 * rate limit de Yahoo como syncs concurrentes del mismo símbolo contra
 * la base). Devuelve resultados y errores por símbolo, sin que el fallo
 * de una acción tumbe al resto del grupo.
 *
 * @param {string[]} symbols
 * @param {string[]} intervals  qué granularidades bajar de cada símbolo.
 *        Al dar de alta se piden las dos, para que la acción quede
 *        completa y no aparezca vacía al cambiar de plazo. El `data`
 *        del resultado es el del PRIMER intervalo (el diario trae la
 *        cotización viva).
 */
export async function syncMany(symbols, intervals = ["1d", "1h"]) {
  const list = [...new Set(symbols)];   // dedup: un símbolo repetido sería sync de más
  const results = [];

  for (let i = 0; i < list.length; i++) {
    if (i > 0) await sleep(RATE_LIMIT_MS); // pausa entre símbolos

    try {
      let first = null;
      for (const iv of intervals) {
        const r = await syncStock(list[i], iv);
        if (first == null) first = r;
      }
      results.push({ symbol: list[i], ok: true, data: first });
    } catch (err) {
      results.push({ symbol: list[i], ok: false, error: err.message ?? String(err) });
    }
  }

  return results;
}