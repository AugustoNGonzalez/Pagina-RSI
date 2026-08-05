// Controllers/stocksController.js
// Endpoints de acciones: listar, agregar/sincronizar, borrar, el RSI de
// cada una (persistido o por plazo), la matriz de ratios y el vaciado
// total de la base.

import { getConnection, sql } from "../Database/connection.js";
import * as q from "../Database/queries.js";
import { syncStock } from "../Services/syncService.js";
import { RSI_PERIOD } from "../Services/serviceConfig.js";
import { buildRatioMatrix } from "../Services/ratioService.js";
import { applyTimeframe } from "../Services/timeframeService.js";
import { calculateRSI } from "../Services/rsiService.js";

// Distingue "el símbolo no existe" (culpa del input del usuario → 404)
// de un error real del servidor/Yahoo (→ 500). Mismo criterio heurístico
// que isNonRetryable en marketDataService.
function isSymbolNotFound(err) {
  const msg = (err?.message ?? "").toLowerCase();
  const status = err?.response?.status ?? err?.status;
  return status === 404 ||
    msg.includes("not found") ||
    msg.includes("delisted") ||
    msg.includes("no data");
}

// Normaliza la lista de símbolos del body y el plazo pedido.
function readSymbols(body) {
  return (Array.isArray(body?.symbols) ? body.symbols : [])
    .filter(s => typeof s === "string" && s.trim())
    .map(s => s.trim().toUpperCase());
}

// Sólo "1wk" cambia el comportamiento; cualquier otro valor cae a diario.
// ("1h" todavía no está implementado: necesita fetch propio.)
const readTimeframe = body => (body?.timeframe === "1wk" ? "1wk" : "1d");

/**
 * Lee los cierres guardados de un conjunto de símbolos y los devuelve
 * agrupados por símbolo. Si el body trae `live`, agrega el precio del
 * momento como última vela: sin eso los indicadores quedarían un día
 * atrasados (StockPrices sólo guarda velas cerradas).
 */
async function loadClosesBySymbol(symbols, live) {
  const pool = await getConnection();

  const result = await pool.request()
    .input("Symbols", sql.NVarChar(sql.MAX), symbols.join(","))
    .query(q.SELECT_CLOSES_FOR_SYMBOLS);

  const bySymbol = new Map();
  for (const r of result.recordset ?? []) {
    let arr = bySymbol.get(r.Symbol);
    if (!arr) bySymbol.set(r.Symbol, arr = []);
    arr.push({ epoch: Number(r.Epoch), close: Number(r.ClosePrice) });
  }

  if (live && typeof live === "object") {
    // Un mismo epoch sintético para todos, así intersecta igual que los
    // cierres reales. "Ahora" siempre es posterior a cualquier guardado.
    const nowEpoch = Math.floor(Date.now() / 1000);
    for (const [symbol, price] of Object.entries(live)) {
      const arr = bySymbol.get(symbol);
      const p = Number(price);
      if (arr && Number.isFinite(p) && p > 0) arr.push({ epoch: nowEpoch, close: p });
    }
  }

  return bySymbol;
}

// GET /api/stocks — todas las acciones cargadas, con su último precio
export async function getAllStocks(req, res) {
  try {
    const pool = await getConnection();
    const result = await pool.request().query(q.SELECT_ALL_STOCKS);

    res.json(result.recordset ?? []);

  } catch (err) {
    console.error("[getAllStocks]", err);
    res.status(500).json({ error: "Error obteniendo stocks" });
  }
}

// POST /api/stocks { symbol } — da de alta una acción, o la actualiza si
// ya existe (es el mismo flujo). La respuesta incluye `live` con precio
// y RSI del momento, para que el frontend pinte sin re-fetch.
export async function addStock(req, res) {
  const { symbol } = req.body ?? {};

  if (!symbol || typeof symbol !== "string" || !symbol.trim()) {
    return res.status(400).json({ error: "Symbol requerido" });
  }

  const clean = symbol.trim().toUpperCase();

  try {
    res.json(await syncStock(clean));

  } catch (err) {
    if (isSymbolNotFound(err)) {
      return res.status(404).json({ error: `Símbolo no encontrado: ${clean}` });
    }

    console.error("[addStock]", err);
    res.status(500).json({ error: "Error sincronizando stock" });
  }
}

// DELETE /api/stocks/:id — borra una acción. Las FKs con ON DELETE
// CASCADE limpian automáticamente (y de forma atómica) sus precios, RSI,
// última cotización y membresías de grupo: es un solo statement, no
// hace falta transacción ni limpieza manual.
export async function deleteStock(req, res) {
  const stockId = Number(req.params.id);
  if (!Number.isInteger(stockId) || stockId <= 0) {
    return res.status(400).json({ error: "StockId inválido" });
  }

  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("StockId", sql.Int, stockId)
      .query(q.DELETE_STOCK);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Stock no encontrado" });
    }

    res.json({ deleted: true });

  } catch (err) {
    console.error("[deleteStock]", err);
    res.status(500).json({ error: "Error eliminando stock" });
  }
}

// GET /api/rsi/matrix — último RSI DIARIO persistido de cada acción.
// Alimenta la carga inicial de la tabla; después el frontend pide el RSI
// del plazo activo por /rsi/by-timeframe.
export async function getRSIMatrix(req, res) {
  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("RSIPeriod", sql.Int, RSI_PERIOD)
      .query(q.SELECT_LAST_RSI_FOR_SYMBOLS);

    res.json(result.recordset ?? []);

  } catch (err) {
    console.error("[getRSIMatrix]", err);
    res.status(500).json({ error: "Error obteniendo matriz RSI" });
  }
}

/**
 * POST /api/rsi/by-timeframe { symbols, timeframe, live } — RSI de cada
 * símbolo en el plazo pedido, calculado al vuelo desde las velas diarias
 * guardadas. El semanal no se persiste: se deriva agrupando por semana
 * (el cierre semanal es el último cierre diario de esa semana).
 * @returns [{ symbol, rsi }]
 */
export async function getRSIByTimeframe(req, res) {
  const symbols = readSymbols(req.body);
  const timeframe = readTimeframe(req.body);

  if (!symbols.length) return res.json([]);

  try {
    const bySymbol = await loadClosesBySymbol(symbols, req.body?.live);

    const out = [...bySymbol].map(([symbol, daily]) => {
      const series = applyTimeframe(daily, timeframe);
      const withRSI = calculateRSI(series, RSI_PERIOD);
      return { symbol, rsi: withRSI.at(-1)?.rsi ?? null };
    });

    res.json(out);

  } catch (err) {
    console.error("[getRSIByTimeframe]", err);
    res.status(500).json({ error: "Error calculando el RSI" });
  }
}

/**
 * POST /api/rsi/ratio-matrix — matriz N×N con el RSI de cada par A/B.
 * Se calcula al vuelo desde los cierres guardados: son N² series que
 * cambian con cada vela nueva, y recalcularlas cuesta milisegundos.
 *
 * Body:
 *   symbols: string[]  qué acciones incluir. Sin esto habría que armar
 *     los N² pares del catálogo entero (con 38 acciones son ~1400 pares
 *     y un segundo de cómputo BLOQUEANTE: no hay await en el medio).
 *   timeframe: "1d"|"1wk"  plazo de las velas del ratio.
 *   live: { SYMBOL: precio }  precios del momento que el frontend ya
 *     tiene de los syncs, para que la matriz refleje el instante actual.
 */
export async function getRatioMatrix(req, res) {
  const symbols = readSymbols(req.body);
  const timeframe = readTimeframe(req.body);

  if (symbols.length < 2) {
    return res.json({ rows: [] });   // con menos de 2 no hay par posible
  }

  try {
    const bySymbol = await loadClosesBySymbol(symbols, req.body?.live);

    // ratioService intersecta por epoch, así que necesita Maps
    const stocks = [...bySymbol].map(([symbol, arr]) => ({
      symbol,
      closes: new Map(arr.map(c => [c.epoch, c.close]))
    }));

    res.json(buildRatioMatrix(stocks, RSI_PERIOD, timeframe));

  } catch (err) {
    console.error("[getRatioMatrix]", err);
    res.status(500).json({ error: "Error obteniendo la matriz de ratios" });
  }
}

// DELETE /api/data — vacía la base: todas las acciones y todos los
// grupos, con su historial (las FKs en cascada hacen el resto).
// En transacción: o se borra todo, o no se borra nada.
// La confirmación con el usuario es responsabilidad del frontend.
export async function clearAllData(req, res) {
  let tx;
  try {
    const pool = await getConnection();
    tx = new sql.Transaction(pool);

    await tx.begin();
    await tx.request().query(q.DELETE_ALL_GROUPS);
    await tx.request().query(q.DELETE_ALL_STOCKS);
    await tx.commit();

    res.json({ cleared: true });

  } catch (err) {
    console.error("[clearAllData]", err);
    if (tx) {
      try { await tx.rollback(); } catch (e) { console.error("[clearAllData][rollback]", e); }
    }
    res.status(500).json({ error: "Error vaciando la base de datos" });
  }
}