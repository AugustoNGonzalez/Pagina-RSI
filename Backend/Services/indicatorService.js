// Services/indicatorService.js
// Registro de indicadores y punto único de cálculo.
//
// Cada indicador es una entrada del registro con: cómo calcularlo sobre
// una serie de velas, y qué escala usa para que el frontend sepa
// colorearlo. El cálculo en sí vive en su propio service (rsiService,
// etc.): acá sólo se declara y se orquesta.
//
// Agregar un indicador nuevo = escribir su función pura + sumar una
// entrada acá. Nada de controllers ni rutas.
//
// Nada de esto se persiste: se calcula al vuelo desde las velas en cada
// request. Con series de miles de velas son milisegundos, y persistir
// obligaría a una tabla por indicador y plazo que además puede quedar
// desincronizada de los precios.

import { calculateRSI } from "./rsiService.js";
import { applyTimeframe } from "./timeframeService.js";
import { RSI_PERIOD } from "./serviceConfig.js";

/**
 * Registro. Cada entrada:
 *   label   nombre corto para el encabezado de la tabla
 *   scale   cómo interpretar el valor. "bounded" = rango fijo conocido
 *           (el frontend colorea con gradiente centrado en `neutral`).
 *           Otros indicadores traerán "unbounded" o "categorical".
 *   min/max/neutral  sólo para scale "bounded"
 *   compute(candles) → number|string|null   valor del ÚLTIMO punto de la
 *           serie ya agregada al plazo pedido. null si no hay historial
 *           suficiente.
 */
const REGISTRY = {
  rsi: {
    label: "RSI",
    scale: "bounded",
    min: 0,
    max: 100,
    neutral: 50,
    compute(candles) {
      if (candles.length < RSI_PERIOD + 1) return null;
      return calculateRSI(candles, RSI_PERIOD).at(-1)?.rsi ?? null;
    }
  }
};

// Ids de los indicadores disponibles. Uso interno: hacia afuera el
// catálogo se expone con getIndicatorMeta(), que además trae las escalas.
const INDICATOR_IDS = Object.keys(REGISTRY);

/**
 * Metadata de los indicadores, para que el frontend arme columnas y
 * escalas sin conocerlos de antemano.
 * @returns {Array<{id, label, scale, min?, max?, neutral?}>}
 */
export function getIndicatorMeta() {
  return Object.entries(REGISTRY).map(([id, def]) => ({
    id,
    label: def.label,
    scale: def.scale,
    ...(def.scale === "bounded" ? { min: def.min, max: def.max, neutral: def.neutral } : {})
  }));
}

/** Descarta ids desconocidos; si no queda ninguno, usa todos. */
export function normalizeIndicatorIds(ids) {
  const valid = (Array.isArray(ids) ? ids : []).filter(id => REGISTRY[id]);
  return valid.length ? valid : INDICATOR_IDS;
}

/**
 * Calcula UN indicador sobre UNA serie de velas ya armada, aplicando
 * antes la agregación del plazo. La usa la matriz de ratios, donde la
 * serie es sintética (el cociente entre dos acciones) y no viene de la
 * base.
 *
 * @param {string} id
 * @param {Array<{epoch, open, high, low, close, volume}>} candles
 * @param {"1d"|"1h"|"1wk"} timeframe
 */
export function computeOne(id, candles, timeframe) {
  const def = REGISTRY[id];
  if (!def) return null;

  const series = applyTimeframe(candles, timeframe);
  if (!series.length) return null;

  return def.compute(series);
}

/**
 * Calcula varios indicadores para varios símbolos de una sola pasada.
 * La agregación al plazo se hace UNA vez por símbolo y se reusa para
 * todos los indicadores, en vez de re-agrupar por cada uno.
 *
 * @param {Map<string, Array>} candlesBySymbol  velas base por símbolo
 * @param {string[]} ids
 * @param {"1d"|"1h"|"1wk"} timeframe
 * @returns {Array<{symbol, values: Object<string, number|string|null>}>}
 */
export function computeForSymbols(candlesBySymbol, ids, timeframe) {
  const wanted = normalizeIndicatorIds(ids);

  return [...candlesBySymbol].map(([symbol, candles]) => {
    const series = applyTimeframe(candles, timeframe);

    const values = {};
    for (const id of wanted) {
      values[id] = series.length ? REGISTRY[id].compute(series) : null;
    }

    return { symbol, values };
  });
}