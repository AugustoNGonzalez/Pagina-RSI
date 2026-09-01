// Services/stockService.js
// Alta y búsqueda de acciones (tabla Stocks).

import { getConnection, sql } from "../Database/connection.js";
import * as q from "../Database/queries.js";

// Corta strings al largo máximo de su columna (evita error de
// truncamiento de SQL Server si Yahoo trae nombres muy largos).
const clip = (v, max) => (v == null ? null : String(v).slice(0, max));

/** Un símbolo suelto: recortado y en mayúsculas, que es como se guarda.
 *  Sin export: afuera sólo hace falta la versión de lista. */
const normalizeSymbol = s => String(s ?? "").trim().toUpperCase();

/**
 * Normaliza la lista de símbolos que llega en el body de un request:
 * descarta lo que no sea texto o venga vacío, pasa a mayúsculas y
 * deduplica. Tolerante a que `symbols` no sea un array.
 *
 * Vive acá, y no repetida en cada controller, porque este módulo es el
 * dueño de la tabla Stocks: si dos implementaciones se desincronizaran,
 * el símbolo con el que se consultan los indicadores dejaría de coincidir
 * con el que se guardó al dar de alta, y la fila desaparecería de la
 * matriz sin ningún error. Es el único helper duplicado del backend cuyo
 * riesgo era silencioso; el resto (sleep, clip) siguen siendo copias
 * locales a propósito: son de una línea y divergir no les hace daño.
 */
export function normalizeSymbols(symbols) {
  return [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .filter(s => typeof s === "string" && s.trim())
      .map(normalizeSymbol)
  )];
}

/**
 * StockId de un símbolo ya cargado, o null si no existe. Consulta barata
 * que permite decidir cuánto histórico pedirle a Yahoo antes de hacer el
 * fetch: histórico completo si es nueva, sólo el hueco si ya existe.
 */
export async function findStockBySymbol(symbol) {
  const pool = await getConnection();

  const res = await pool.request()
    .input("Symbol", sql.NVarChar(20), normalizeSymbol(symbol))
    .query(q.SELECT_STOCK_BY_SYMBOL);

  return res.recordset[0]?.StockId ?? null;
}

/**
 * Busca una acción por símbolo; si no existe todavía, la crea con los
 * metadatos que vinieron de Yahoo Finance. Devuelve el StockId en
 * cualquiera de los dos casos (patrón get-or-create).
 *
 * Los metadatos se graban SÓLO al alta: si una empresa se renombra o
 * cambia de bolsa, el dato queda viejo hasta que se borre y recargue
 * la acción. Aceptable para este proyecto.
 */
export async function getOrCreateStock(meta) {
  if (!meta?.symbol || typeof meta.symbol !== "string") {
    throw new Error("Symbol inválido");
  }

  const symbol = normalizeSymbol(meta.symbol);
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