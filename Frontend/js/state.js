// Frontend/js/state.js
// Estado de la aplicación y su sistema de notificación.
//
// Todo lo que la UI necesita saber vive acá: el catálogo de acciones, la
// selección visible, los grupos, la matriz, el plazo y las columnas
// activas. Los módulos leen con getters, escriben con setters, y se
// suscriben para enterarse de los cambios.
//
// Esto reemplaza al patrón anterior, donde cada handler tenía que
// acordarse de llamar render() y recargar los indicadores a mano: era
// la fuente de la mitad de los bugs (una función que cambiaba la vista y
// se olvidaba de repintar la matriz).

import {
  SELECTED_KEY, TIMEFRAME_KEY, COLUMNS_KEY, MATRIX_KEY,
  DEFAULT_TIMEFRAME, DEFAULT_INDICATOR
} from "./config.js";

// ============ Datos ============

let catalog = [];                    // todas las acciones cargadas en la base
let groups = [];                     // grupos con su cantidad de miembros
let matrix = { rows: [] };           // matriz de ratios del indicador activo
let indicatorMeta = [];              // catálogo de indicadores (del backend)

const selected = new Set();          // símbolos visibles en la tabla
const syncing = new Set();           // símbolos con un sync en curso

// ============ Preferencias (por navegador) ============

let timeframe = localStorage.getItem(TIMEFRAME_KEY) ?? DEFAULT_TIMEFRAME;
let matrixIndicator = localStorage.getItem(MATRIX_KEY) ?? DEFAULT_INDICATOR;
let columns = loadColumns();

function loadColumns() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMNS_KEY));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch { /* JSON corrupto: se ignora */ }
  return [DEFAULT_INDICATOR];
}

// ============ Suscripción ============

const listeners = new Set();

/** Registra un callback que se ejecuta ante cualquier cambio de estado. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Repintar es caro: se reconstruyen la tabla entera y la matriz N×N. Un
// ciclo de sincronización dispara cuatro setters por símbolo (markSyncing,
// applyQuote, mergeIndicators, markSyncing de nuevo), así que con 20
// acciones eran ~80 renders completos, casi todos pisados por el
// siguiente antes de que el usuario llegara a verlos. Se agrupa en uno
// solo por frame.
let notifyPending = false;

/** Avisa a los suscriptos. Lo llaman los setters, no los módulos. */
function notify() {
  if (notifyPending) return;
  notifyPending = true;

  requestAnimationFrame(() => {
    notifyPending = false;
    for (const fn of listeners) fn();
  });
}

// ============ Lecturas ============

export const getCatalog = () => catalog;
export const getGroups = () => groups;
export const getMatrix = () => matrix;
export const getIndicatorMeta = () => indicatorMeta;
export const getTimeframe = () => timeframe;
export const getMatrixIndicator = () => matrixIndicator;
export const getColumns = () => columns;
export const getSyncing = () => syncing;

/** Acciones visibles, en el orden del catálogo. */
export const getVisible = () => catalog.filter(s => selected.has(s.symbol));

/** Símbolos visibles, como array. */
export const getSelected = () => [...selected];

export const isSelected = symbol => selected.has(symbol);
export const isSyncing = symbol => syncing.has(symbol);

/** Precios del momento por símbolo, para que el backend cierre el
 *  período en curso al calcular indicadores.
 *
 *  Sólo los visibles: el backend descarta los símbolos que no pidió, así
 *  que mandar el catálogo entero era payload al pedo que crecía con cada
 *  acción cargada, en cada request de indicadores. */
export function getLivePrices() {
  const out = {};
  for (const s of catalog) {
    if (selected.has(s.symbol) && typeof s.lastPrice === "number") {
      out[s.symbol] = s.lastPrice;
    }
  }
  return out;
}

// ============ Escrituras ============

export function setCatalog(next) {
  catalog = next;
  notify();
}

export function setGroups(next) {
  groups = next;
  notify();
}

export function setMatrix(next) {
  matrix = next ?? { rows: [] };
  notify();
}

export function setIndicatorMeta(next) {
  indicatorMeta = Array.isArray(next) ? next : [];
  notify();
}

/** Aplica la cotización viva de un sync sobre una acción del catálogo. */
export function applyQuote(symbol, live) {
  const s = catalog.find(c => c.symbol === symbol);
  if (!s || !live) return;

  if (typeof live.price === "number") s.lastPrice = live.price;
  if (typeof live.previousClose === "number") s.previousClose = live.previousClose;
  s.updatedAt = new Date().toISOString();
  notify();
}

/**
 * Escribe los valores de indicadores calculados por el backend.
 * Los símbolos que no vinieron quedan con `values` vacío: significa
 * "no hay datos para este plazo", no "conservá los de antes".
 */
export function applyIndicators(rows) {
  const bySymbol = new Map(rows.map(r => [r.symbol, r.values]));

  for (const s of catalog) {
    s.values = bySymbol.get(s.symbol) ?? {};
  }
  notify();
}

/**
 * Igual que applyIndicators pero parcial: sólo toca los símbolos que
 * vinieron, sin vaciar el resto. Para actualizar de a una fila durante
 * un ciclo de sincronización.
 */
export function mergeIndicators(rows) {
  const bySymbol = new Map(rows.map(r => [r.symbol, r.values]));

  for (const s of catalog) {
    if (bySymbol.has(s.symbol)) s.values = bySymbol.get(s.symbol);
  }
  notify();
}

// --- Selección ---

export function select(symbols) {
  for (const s of symbols) selected.add(s);
  saveSelection();
  notify();
}

export function deselect(symbol) {
  selected.delete(symbol);
  saveSelection();
  notify();
}

export function replaceSelection(symbols) {
  selected.clear();
  for (const s of symbols) selected.add(s);
  saveSelection();
  notify();
}

export function clearSelection() {
  selected.clear();
  saveSelection();
  notify();
}

/** Restaura la selección guardada, descartando símbolos que ya no
 *  existen. Sin preferencia previa, se muestran todas. */
export function restoreSelection() {
  let saved = null;
  try {
    const raw = JSON.parse(localStorage.getItem(SELECTED_KEY));
    if (Array.isArray(raw)) saved = raw;
  } catch { /* JSON corrupto: se ignora */ }

  selected.clear();
  if (saved) {
    for (const sym of saved) {
      if (catalog.some(c => c.symbol === sym)) selected.add(sym);
    }
  } else {
    for (const c of catalog) selected.add(c.symbol);
  }
  saveSelection();
  notify();
}

function saveSelection() {
  localStorage.setItem(SELECTED_KEY, JSON.stringify([...selected]));
}

// --- Sync en curso (para el ↻ girando de cada fila) ---

export function markSyncing(symbol, on) {
  if (on) syncing.add(symbol);
  else syncing.delete(symbol);
  notify();
}

// --- Preferencias ---

export function setTimeframe(tf) {
  timeframe = tf;
  localStorage.setItem(TIMEFRAME_KEY, tf);
  notify();
}

export function setMatrixIndicator(id) {
  matrixIndicator = id;
  localStorage.setItem(MATRIX_KEY, id);
  notify();
}

export function setColumns(ids) {
  columns = ids;
  localStorage.setItem(COLUMNS_KEY, JSON.stringify(ids));
  notify();
}