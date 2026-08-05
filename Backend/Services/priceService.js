// Services/priceService.js
// Persistencia de precios: leer el último epoch guardado, insertar lotes
// de velas COMPLETADAS, y actualizar la última cotización viva.
// La vela en curso del día nunca pasa por acá (vive solo en memoria);
// el filtrado es responsabilidad de syncService.

import { getConnection, sql } from "../Database/connection.js";
import * as q from "../Database/queries.js";

// Epoch de la vela más reciente ya guardada para una acción (null si
// todavía no tiene ninguna).
export async function getLastEpoch(stockId) {
  const pool = await getConnection();

  const res = await pool.request()
    .input("StockId", sql.Int, stockId)
    .query(q.GET_LAST_EPOCH);

  const epoch = res.recordset[0]?.LastEpoch;
  return epoch != null ? Number(epoch) : null;
}

/**
 * Inserta un lote de velas COMPLETADAS para una acción usando bulk insert
 * (mucho más rápido que insertar fila por fila). Va en transacción, que
 * hoy es redundante (el bulk ya es atómico) pero deja el andamiaje listo
 * si el lote crece a varias operaciones.
 *
 * PriceDate no se envía: es columna calculada, la deriva SQL Server.
 * Quien llama debe haber filtrado ya epoch > getLastEpoch() y excluido
 * la vela en curso: un duplicado acá es síntoma de un bug upstream.
 *
 * @returns cantidad de velas insertadas
 */
export async function persistCandlesBulk(stockId, candles) {
  if (!candles?.length) return 0;

  const pool = await getConnection();
  const tx = new sql.Transaction(pool);

  // sql.Table arma el insert masivo (bulk copy) en vez de un INSERT por fila
  const table = new sql.Table("StockPrices");
  table.create = false; // la tabla ya existe, no hay que crearla

  table.columns.add("StockId", sql.Int, { nullable: false });
  table.columns.add("Epoch", sql.BigInt, { nullable: false });
  table.columns.add("OpenPrice", sql.Decimal(18, 6), { nullable: true });
  table.columns.add("HighPrice", sql.Decimal(18, 6), { nullable: true });
  table.columns.add("LowPrice", sql.Decimal(18, 6), { nullable: true });
  table.columns.add("ClosePrice", sql.Decimal(18, 6), { nullable: true });
  table.columns.add("Volume", sql.BigInt, { nullable: true });

  for (const c of candles) {
    table.rows.add(
      stockId,
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

    // Error 2627 = violación de PK (StockId+Epoch repetido). Con el
    // filtrado correcto en syncService esto NO debería pasar nunca:
    // si aparece, hay un bug en el filtro de epochs o se coló la vela
    // en curso. Se loguea fuerte pero no se tumba el sync.
    if (err.number === 2627) {
      console.warn(
        `[priceService][persistCandlesBulk] ADVERTENCIA: duplicado ` +
        `inesperado para stockId=${stockId}. Revisar filtro de epochs ` +
        `en syncService.`
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
 * con el cierre de la última vela completada. La llama syncService en
 * cada sincronización.
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