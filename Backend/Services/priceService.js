// Services/priceService.js
// Persistencia de velas: leer el último epoch guardado, insertar lotes
// de velas COMPLETADAS, y actualizar la última cotización viva.
// Todo por intervalo ('1d' | '1h'): las velas de distinta granularidad
// conviven en StockPrices separadas por la columna Interval.
// La vela en curso nunca pasa por acá (vive sólo en memoria); el
// filtrado es responsabilidad de syncService.

import { getConnection, sql } from "../Database/connection.js";
import * as q from "../Database/queries.js";

/**
 * Epoch de la vela completada más reciente guardada para una acción en
 * un intervalo, o null si todavía no tiene ninguna. Determina cuánto
 * histórico hay que pedirle a Yahoo y qué velas del fetch son nuevas.
 */
export async function getLastEpoch(stockId, interval) {
  const pool = await getConnection();

  const res = await pool.request()
    .input("StockId", sql.Int, stockId)
    .input("Interval", sql.NVarChar(5), interval)
    .query(q.GET_LAST_EPOCH);

  const epoch = res.recordset[0]?.LastEpoch;
  return epoch != null ? Number(epoch) : null;
}

/**
 * Inserta un lote de velas COMPLETADAS usando bulk insert (mucho más
 * rápido que insertar fila por fila). Va en transacción, que hoy es
 * redundante (el bulk ya es atómico) pero deja el andamiaje listo si el
 * lote crece a varias operaciones.
 *
 * PriceDate no se envía: es columna calculada, la deriva SQL Server.
 * Quien llama debe haber filtrado ya epoch > getLastEpoch() y excluido
 * la vela en curso: un duplicado acá es síntoma de un bug upstream.
 *
 * @param {number} stockId
 * @param {"1d"|"1h"} interval
 * @param {Array<{epoch, open, high, low, close, volume}>} candles
 * @returns {Promise<number>} cantidad de velas insertadas
 */
export async function persistCandlesBulk(stockId, interval, candles) {
  if (!candles?.length) return 0;

  const pool = await getConnection();
  const tx = new sql.Transaction(pool);

  // sql.Table arma el insert masivo (bulk copy) en vez de un INSERT por fila
  const table = new sql.Table("StockPrices");
  table.create = false; // la tabla ya existe, no hay que crearla

  table.columns.add("StockId", sql.Int, { nullable: false });
  table.columns.add("Interval", sql.NVarChar(5), { nullable: false });
  table.columns.add("Epoch", sql.BigInt, { nullable: false });
  table.columns.add("OpenPrice", sql.Decimal(18, 6), { nullable: true });
  table.columns.add("HighPrice", sql.Decimal(18, 6), { nullable: true });
  table.columns.add("LowPrice", sql.Decimal(18, 6), { nullable: true });
  table.columns.add("ClosePrice", sql.Decimal(18, 6), { nullable: true });
  table.columns.add("Volume", sql.BigInt, { nullable: true });

  for (const c of candles) {
    table.rows.add(
      stockId,
      interval,
      c.epoch,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume
    );
  }

  try {
    await tx.begin();
    await tx.request().bulk(table);
    await tx.commit();
    return candles.length;

  } catch (err) {
    // Si el fallo fue en begin(), no hay transacción que revertir: el
    // rollback tiraría su propio error y taparía el original.
    try { await tx.rollback(); } catch { /* ya estaba cerrada */ }

    // Error 2627 = violación de PK (StockId+Interval+Epoch repetido).
    // Con el filtrado correcto en syncService esto NO debería pasar
    // nunca: si aparece, hay un bug en el filtro de epochs o se coló la
    // vela en curso. Se loguea fuerte pero no se tumba el sync.
    if (err.number === 2627) {
      console.warn(
        `[priceService][persistCandlesBulk] ADVERTENCIA: duplicado ` +
        `inesperado para stockId=${stockId} interval=${interval}. ` +
        `Revisar filtro de epochs en syncService.`
      );
      return 0;
    }

    console.error("[priceService][persistCandlesBulk]", err);
    throw err;
  }
}

/**
 * Actualiza (o crea) la última cotización conocida de una acción con la
 * cotización VIVA que viene del meta de Yahoo (regularMarketPrice), no
 * con el cierre de la última vela completada. No depende del intervalo:
 * el precio del momento es uno solo.
 */
export async function upsertLastQuote(stockId, { lastPrice, previousClose, lastEpoch }) {
  const pool = await getConnection();

  await pool.request()
    .input("StockId", sql.Int, stockId)
    .input("LastPrice", sql.Decimal(18, 6), lastPrice)
    .input("PreviousClose", sql.Decimal(18, 6), previousClose)
    .input("LastEpoch", sql.BigInt, lastEpoch)
    .query(q.UPSERT_LAST_QUOTE);
}

/**
 * Velas completas (OHLCV) de varios símbolos en un intervalo, agrupadas
 * por símbolo y ordenadas de más vieja a más nueva. Es la lectura base
 * de todos los indicadores y de la matriz de ratios.
 *
 * @param {string[]} symbols
 * @param {"1d"|"1h"} interval
 * @returns {Promise<Map<string, Array<{epoch, open, high, low, close, volume}>>>}
 */
export async function loadCandlesBySymbol(symbols, interval) {
  const bySymbol = new Map();
  if (!symbols?.length) return bySymbol;

  const pool = await getConnection();

  const result = await pool.request()
    .input("Symbols", sql.NVarChar(sql.MAX), symbols.join(","))
    .input("Interval", sql.NVarChar(5), interval)
    .query(q.SELECT_CANDLES_FOR_SYMBOLS);

  for (const r of result.recordset ?? []) {
    let arr = bySymbol.get(r.Symbol);
    if (!arr) bySymbol.set(r.Symbol, arr = []);
    arr.push({
      epoch: Number(r.Epoch),
      open: r.OpenPrice != null ? Number(r.OpenPrice) : null,
      high: r.HighPrice != null ? Number(r.HighPrice) : null,
      low: r.LowPrice != null ? Number(r.LowPrice) : null,
      close: Number(r.ClosePrice),
      volume: r.Volume != null ? Number(r.Volume) : null
    });
  }

  return bySymbol;
}