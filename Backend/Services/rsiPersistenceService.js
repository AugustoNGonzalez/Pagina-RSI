// Services/rsiPersistenceService.js
// Calcula el RSI de una acción a partir de los precios ya guardados y
// persiste sólo los valores nuevos.
//
// El cálculo SIEMPRE corre sobre el histórico completo de precios: el
// RSI de Wilder es recursivo (cada promedio depende del anterior desde
// el origen de la serie), así que no se puede calcular sobre una ventana
// parcial sin romper el empalme con los valores ya guardados. Recalcular
// todo es barato (milisegundos incluso con años de velas diarias); lo
// que se limita es la PERSISTENCIA: sólo se insertan los RSI con epoch
// posterior al último ya guardado.

import { getConnection, sql } from "../Database/connection.js";
import { calculateRSI } from "./rsiService.js";
import { RSI_PERIOD } from "./serviceConfig.js";
import * as q from "../Database/queries.js";

// Epoch del último RSI ya calculado y guardado para una acción+período.
// Local: sólo la usa computeAndPersistRSIBulk, más abajo.
async function getLastRSIEpoch(stockId, period) {
  const pool = await getConnection();

  const res = await pool.request()
    .input("StockId", sql.Int, stockId)
    .input("RSIPeriod", sql.Int, period)
    .query(q.GET_LAST_RSI_EPOCH);

  const epoch = res.recordset[0]?.LastRSIEpoch;
  return epoch != null ? Number(epoch) : null;
}

/**
 * Calcula el RSI de todo el histórico de una acción y persiste los
 * valores nuevos (posteriores al último ya guardado).
 *
 * Sólo trabaja con velas COMPLETADAS (StockPrices nunca contiene la vela
 * en curso del día). El RSI vivo intradía lo calcula syncService en
 * memoria y no pasa por acá.
 *
 * @returns {Promise<{persisted: number, lastPersistedEpoch?: number}>}
 *          persisted = cuántos RSI nuevos se guardaron (0 es lo normal
 *          en un sync sin velas nuevas)
 */
export async function computeAndPersistRSIBulk(stockId, period = RSI_PERIOD) {
  const pool = await getConnection();

  const lastRSIEpoch = await getLastRSIEpoch(stockId, period);

  // Histórico completo de cierres, de más viejo a más nuevo
  const pricesRes = await pool.request()
    .input("StockId", sql.Int, stockId)
    .query(q.SELECT_PRICES_FOR_RSI);

  const candles = pricesRes.recordset
    .filter(r => r.ClosePrice != null)   // huecos de Yahoo: sin cierre no hay delta
    .map(r => ({
      epoch: Number(r.Epoch),
      close: Number(r.ClosePrice)
    }));

  // Sin al menos `period + 1` cierres no se puede calcular ni un RSI
  if (candles.length < period + 1) {
    return { persisted: 0 };
  }

  // calculateRSI devuelve la serie completa; nos quedamos sólo con los
  // puntos que tienen RSI y que todavía no están guardados.
  const withRSI = calculateRSI(candles, period)
    .filter(r => r.rsi != null && (lastRSIEpoch == null || r.epoch > lastRSIEpoch));

  if (!withRSI.length) {
    return { persisted: 0 };
  }

  // Igual que en priceService: bulk insert dentro de una transacción.
  const table = new sql.Table("StockRSI");
  table.create = false;

  table.columns.add("StockId", sql.Int, { nullable: false });
  table.columns.add("Epoch", sql.BigInt, { nullable: false });
  table.columns.add("RSIPeriod", sql.Int, { nullable: false });
  table.columns.add("RSI", sql.Decimal(6, 3), { nullable: false });

  for (const r of withRSI) {
    table.rows.add(stockId, r.epoch, period, r.rsi);
  }

  const tx = new sql.Transaction(pool);

  try {
    await tx.begin();
    await tx.request().bulk(table);
    await tx.commit();

    return {
      persisted: withRSI.length,
      lastPersistedEpoch: withRSI.at(-1).epoch
    };

  } catch (err) {
    // Si el fallo fue en begin(), no hay transacción que revertir: el
    // rollback tiraría su propio error y taparía el original.
    try { await tx.rollback(); } catch { /* ya estaba cerrada */ }

    // 2627 = PK duplicada. Con el filtro por lastRSIEpoch no debería
    // ocurrir nunca: si aparece, hay un bug (p.ej. dos syncs del mismo
    // símbolo en paralelo). Se loguea fuerte para no taparlo.
    if (err.number === 2627) {
      console.warn(
        `[rsiPersistenceService] ADVERTENCIA: RSI duplicado inesperado ` +
        `para stockId=${stockId} period=${period}. ¿Syncs concurrentes?`
      );
      return { persisted: 0 };
    }

    console.error("[rsiPersistenceService][computeAndPersistRSIBulk]", err);
    throw err;
  }
}