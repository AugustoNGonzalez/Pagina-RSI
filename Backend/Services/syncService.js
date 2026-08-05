// Services/syncService.js
// Orquesta la sincronización completa de una acción: pide datos a Yahoo,
// la da de alta si es nueva, guarda las velas completadas nuevas,
// recalcula/persiste el RSI, actualiza la cotización viva y devuelve
// precio y RSI del momento (intradía) calculados en memoria.
// Es lo que disparan los endpoints de agregar/actualizar acciones.

import { fetchDailyCandles } from "./marketDataService.js";
import { getLastEpoch, persistCandlesBulk, upsertLastQuote } from "./priceService.js";
import { computeAndPersistRSIBulk } from "./rsiPersistenceService.js";
import { calculateRSI } from "./rsiService.js";
import { getOrCreateStock, findStockBySymbol } from "./stockService.js";
import { RSI_PERIOD, HISTORY_YEARS, UPDATE_WINDOW_DAYS, GAP_MARGIN_DAYS, RATE_LIMIT_MS } from "./serviceConfig.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Separa las velas COMPLETADAS de la vela EN CURSO del día.
 *
 * Criterio principal: una vela está en curso si su epoch cae en o después
 * del inicio de la sesión regular de hoy (meta.regularSessionStart).
 * Fallback si Yahoo no trajo ese dato: se usa el inicio del día UTC actual.
 *
 * La vela en curso tiene epoch inestable (cambia entre fetches) y su
 * close es parcial: NUNCA se persiste. Sólo alimenta el cálculo en
 * memoria del RSI vivo y la cotización del momento.
 */
function splitCandles(candles, meta) {
  let cutoff = meta.regularSessionStart;

  if (cutoff == null) {
    const now = new Date();
    cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  }

  const completed = candles.filter(c => c.epoch < cutoff);
  const current = candles.find(c => c.epoch >= cutoff) ?? null;

  return { completed, current };
}

/**
 * Sincroniza una acción de punta a punta. Sirve tanto para darla de alta
 * como para actualizarla: es el mismo flujo. Un solo fetch (para 1d
 * Yahoo devuelve rangos largos sin paginar), con ventana adaptativa
 * según cuánto histórico falte, y el filtro por lastEpoch decide cuánto
 * de lo que llegó es realmente nuevo.
 *
 * @returns {Promise<{
 *   stockId, symbol,
 *   mode: "initial"|"update",
 *   inserted: number,          // velas completadas nuevas persistidas
 *   rsiPersisted: object,      // resultado de computeAndPersistRSIBulk
 *   live: { price, previousClose, rsi, epoch }   // valores del momento
 * }>}
 */
export async function syncStock(symbol) {
  // `to` un día en el futuro: garantiza que la vela de hoy entre al rango
  const to = new Date(Date.now() + ONE_DAY_MS);

  try {
    // Ventana adaptativa: bajar 5 años en cada refresco es desperdicio
    // (esos datos ya están en la base). Si la acción existe, alcanza con
    // cubrir el hueco desde la última vela guardada más el colchón que
    // necesita Wilder para converger (UPDATE_WINDOW_DAYS). Si es nueva,
    // o el hueco es enorme, se pide el histórico completo.
    const FULL_DAYS = Math.round(HISTORY_YEARS * 365);
    const existingId = await findStockBySymbol(symbol);

    let lastEpoch = existingId != null ? await getLastEpoch(existingId) : null;
    let windowDays = FULL_DAYS;

    if (lastEpoch != null) {
      const gapDays = Math.ceil((Date.now() / 1000 - lastEpoch) / 86400);
      windowDays = Math.min(FULL_DAYS, Math.max(UPDATE_WINDOW_DAYS, gapDays + GAP_MARGIN_DAYS));
    }

    const from = new Date(Date.now() - windowDays * ONE_DAY_MS);

    const { meta, candles } = await fetchDailyCandles(symbol, from, to);

    const stockId = await getOrCreateStock(meta);

    // Yahoo puede normalizar el símbolo: si terminó en otra fila, el
    // lastEpoch que leímos antes no corresponde y hay que releerlo.
    if (stockId !== existingId) lastEpoch = await getLastEpoch(stockId);

    // Paso clave 1: la vela en curso se aparta, jamás llega a la base
    const { completed, current } = splitCandles(candles, meta);

    // Paso clave 2: filtro explícito en JS contra lo ya guardado. No se
    // confía en los bordes de period1/period2 de Yahoo (son difusos).
    const newCandles = lastEpoch == null
      ? completed
      : completed.filter(c => c.epoch > lastEpoch);

    const inserted = await persistCandlesBulk(stockId, newCandles);

    // RSI de velas completadas: recalcula la serie completa desde la
    // base y persiste sólo lo nuevo (ver rsiPersistenceService).
    const rsiPersisted = await computeAndPersistRSIBulk(stockId);

    // RSI vivo: en memoria, con las velas del fetch + la vela en curso.
    // Si el mercado está cerrado (current == null), el "vivo" coincide
    // con el último RSI de vela completada.
    const seriesForLive = current ? [...completed, current] : completed;
    const withRSI = calculateRSI(seriesForLive, RSI_PERIOD);
    const liveRSI = withRSI.at(-1)?.rsi ?? null;

    // Cotización viva a StockLastQuote (única tabla que se pisa siempre)
    const livePrice = meta.regularMarketPrice ?? current?.close ?? completed.at(-1)?.close ?? null;
    const liveEpoch = meta.regularMarketTime ?? seriesForLive.at(-1)?.epoch ?? null;

    // previousClose: Yahoo sólo lo incluye en el meta para intervalos
    // intradía; con interval=1d viene ausente. Se deriva de las velas:
    // con vela en curso, el cierre previo es la última completada (ayer);
    // sin vela en curso, la última completada ES la cotización actual y
    // el previo es la anteúltima. (chartPreviousClose NO sirve: es el
    // cierre anterior al inicio del rango, o sea de hace HISTORY_YEARS.)
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
      mode: lastEpoch == null ? "initial" : "update",
      inserted,
      rsiPersisted,
      live: {
        price: livePrice,
        previousClose: prevClose,
        rsi: liveRSI,
        epoch: liveEpoch
      }
    };

  } catch (err) {
    console.error(`[syncService][syncStock] symbol=${symbol}`, err);
    throw err;
  }
}

/**
 * Sincroniza varias acciones EN SERIE (nunca en paralelo: evita tanto el
 * rate limit de Yahoo como syncs concurrentes del mismo símbolo contra
 * la base). Devuelve resultados y errores por símbolo, sin que el fallo
 * de una acción tumbe al resto del grupo.
 */
export async function syncMany(symbols) {
  const results = [];

  for (let i = 0; i < symbols.length; i++) {
    if (i > 0) await sleep(RATE_LIMIT_MS); // pausa entre símbolos

    try {
      results.push({ symbol: symbols[i], ok: true, data: await syncStock(symbols[i]) });
    } catch (err) {
      results.push({ symbol: symbols[i], ok: false, error: err.message ?? String(err) });
    }
  }

  return results;
}