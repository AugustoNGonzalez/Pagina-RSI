// Controllers/indicatorsController.js
// Endpoints de cálculo: valores de indicadores por acción y matriz de
// indicadores sobre ratios entre pares.
//
// Nada de esto se persiste: se calcula al vuelo desde las velas
// guardadas en cada request. El controller sólo normaliza parámetros y
// arma la respuesta; el cálculo vive en los Services.

import { loadCandlesBySymbol } from "../Services/priceService.js";
import { computeForSymbols, getIndicatorMeta, normalizeIndicatorIds } from "../Services/indicatorService.js";
import { buildRatioMatrix } from "../Services/ratioService.js";
import { baseInterval } from "../Services/timeframeService.js";
import { normalizeSymbols } from "../Services/stockService.js";

const TIMEFRAMES = ["1h", "1d", "1wk"];

// Cualquier valor desconocido cae a diario.
const readTimeframe = body => (TIMEFRAMES.includes(body?.timeframe) ? body.timeframe : "1d");

/**
 * Agrega el precio del momento como última vela de cada símbolo. Sin
 * esto los indicadores quedarían un período atrasados: StockPrices sólo
 * guarda velas cerradas, y la del período en curso vive en el frontend
 * (viene de StockLastQuote en cada sync).
 *
 * El OHLC de esa vela sintética se arma con el mismo precio en los
 * cuatro campos: es lo único que se sabe del período en curso sin pedir
 * datos intradía. Para indicadores de cierre (RSI) es exacto; para los
 * de rango será una aproximación del período abierto.
 */
function appendLiveCandle(bySymbol, live) {
  if (!live || typeof live !== "object") return;

  // Un mismo epoch sintético para todos, así intersecta igual que los
  // cierres reales. "Ahora" siempre es posterior a cualquier guardado.
  const nowEpoch = Math.floor(Date.now() / 1000);

  for (const [symbol, price] of Object.entries(live)) {
    const arr = bySymbol.get(symbol);
    const p = Number(price);
    if (!arr || !Number.isFinite(p) || p <= 0) continue;

    arr.push({ epoch: nowEpoch, open: p, high: p, low: p, close: p, volume: null });
  }
}

// GET /api/indicators/meta — qué indicadores existen, cómo se llaman y
// en qué escala se mueven. El frontend arma columnas y colores con esto,
// sin conocerlos de antemano.
export function getMeta(req, res) {
  res.json(getIndicatorMeta());
}

/**
 * POST /api/indicators { symbols, timeframe, indicators, live }
 * Valores de los indicadores pedidos para cada símbolo, en el plazo
 * pedido. Una sola lectura de velas sirve para todos.
 * @returns [{ symbol, values: { rsi: 44.6, ... } }]
 */
export async function getIndicators(req, res) {
  const symbols = normalizeSymbols(req.body?.symbols);
  if (!symbols.length) return res.json([]);

  const timeframe = readTimeframe(req.body);
  const ids = normalizeIndicatorIds(req.body?.indicators);

  try {
    const bySymbol = await loadCandlesBySymbol(symbols, baseInterval(timeframe));
    appendLiveCandle(bySymbol, req.body?.live);

    res.json(computeForSymbols(bySymbol, ids, timeframe));

  } catch (err) {
    console.error("[getIndicators]", err);
    res.status(500).json({ error: "Error calculando indicadores" });
  }
}

/**
 * POST /api/indicators/ratio-matrix { symbols, timeframe, indicator, live }
 * Matriz N×N con el indicador aplicado a cada par A/B.
 *
 * `symbols` no es opcional: con N símbolos son N² pares, así que pedir
 * el catálogo entero serían ~1400 cálculos y un segundo de cómputo
 * BLOQUEANTE (no hay await en el medio del armado de la matriz).
 */
export async function getRatioMatrix(req, res) {
  const symbols = normalizeSymbols(req.body?.symbols);
  if (symbols.length < 2) return res.json({ rows: [] });   // sin par posible

  const timeframe = readTimeframe(req.body);
  const [indicatorId] = normalizeIndicatorIds(
    req.body?.indicator ? [req.body.indicator] : []
  );

  try {
    const bySymbol = await loadCandlesBySymbol(symbols, baseInterval(timeframe));
    appendLiveCandle(bySymbol, req.body?.live);

    // ratioService intersecta por epoch, así que necesita Maps
    const stocks = [...bySymbol].map(([symbol, arr]) => ({
      symbol,
      candles: new Map(arr.map(c => [c.epoch, c]))
    }));

    res.json(buildRatioMatrix(stocks, indicatorId, timeframe));

  } catch (err) {
    console.error("[getRatioMatrix]", err);
    res.status(500).json({ error: "Error obteniendo la matriz de ratios" });
  }
}