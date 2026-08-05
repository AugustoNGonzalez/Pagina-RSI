// Services/stockService.js
// Alta y búsqueda de acciones (tabla Stocks).

import { getConnection, sql } from "../Database/connection.js";
import * as q from "../Database/queries.js";

// Corta strings al largo máximo de su columna (evita error de
// truncamiento de SQL Server si Yahoo trae nombres muy largos).
const clip = (v, max) => (v == null ? null : String(v).slice(0, max));

/**
 * Busca una acción por símbolo; si no existe todavía, la crea con los
 * metadatos que vinieron de Yahoo Finance. Devuelve el StockId en
 * cualquiera de los dos casos (patrón get-or-create).
 *
 * Los metadatos se graban SÓLO al alta: si una empresa se renombra o
 * cambia de bolsa, el dato queda viejo hasta que se borre y recargue
 * la acción. Aceptable para este proyecto.
 */
export async function findStockBySymbol(symbol) {
  const pool = await getConnection();
  const res = await pool.request()
    .input("Symbol", sql.NVarChar(20), String(symbol).trim().toUpperCase())
    .query(q.SELECT_STOCK_BY_SYMBOL);
  return res.recordset[0]?.StockId ?? null;
}

/**
 * Busca una acción por símbolo; si no existe todavía, la crea con los
 * metadatos que vinieron de Yahoo Finance. Devuelve el StockId en
 * cualquiera de los dos casos (patrón get-or-create).
 */
export async function getOrCreateStock(meta) {
  if (!meta?.symbol || typeof meta.symbol !== "string") {
    throw new Error("Symbol inválido");
  }

  const symbol = meta.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("Symbol inválido");

  const existing = await findStockBySymbol(symbol);
  if (existing != null) return existing;

  const pool = await getConnection();

  try {
    const ins = await pool.request()
      .input("Symbol", sql.NVarChar(20), symbol)
      .input("LongName", sql.NVarChar(150), clip(meta.longName, 150))
      .input("ShortName", sql.NVarChar(100), clip(meta.shortName, 100))
      .input("Exchange", sql.NVarChar(50), clip(meta.exchange, 50))
      .input("Currency", sql.NVarChar(10), clip(meta.currency, 10))
      .input("InstrumentType", sql.NVarChar(50), clip(meta.instrumentType, 50))
      .query(q.INSERT_STOCK);

    return ins.recordset[0].StockId;

  } catch (err) {
    // 2627 = otro request insertó el mismo símbolo entre nuestro SELECT
    // y nuestro INSERT (race de get-or-create). La fila ya existe, que
    // era el objetivo: se re-selecciona y listo.
    if (err.number === 2627) {
      const retry = await findStockBySymbol(symbol);
      if (retry != null) return retry;
    }
    throw err;
  }
}

