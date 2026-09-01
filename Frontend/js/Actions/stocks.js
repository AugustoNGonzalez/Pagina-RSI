// Frontend/js/actions/stocks.js
// Acciones sobre el catálogo y la vista: agregar, sincronizar, mostrar y
// ocultar acciones.

import * as api from "../Client/apiClient.js";
import * as state from "../state.js";
import { toast, overlay, overlayOff, progress, progressOff } from "../UI/notify.js";
import { reloadIndicators, reloadOneIndicator } from "./indicators.js";
import { parseSymbols } from "../UI/format.js";

const $ = sel => document.querySelector(sel);

// Sólo el plazo horario necesita su propia descarga de velas; el
// semanal se deriva del diario en el backend.
const intervalFor = tf => (tf === "1h" ? "1h" : "1d");

// ============ Vista ============

/** ✕ de la fila: saca la acción de la VISTA (sigue cargada en el
 *  sistema; para borrarla de verdad está el panel de opciones). */
export async function hideStock(stock) {
  state.deselect(stock.symbol);
  await reloadIndicators();
}

export async function showAll() {
  const missing = state.getCatalog()
    .filter(c => !state.isSelected(c.symbol))
    .map(c => c.symbol);

  if (!missing.length) {
    toast("Ya están todas en la vista", "info");
    return;
  }

  state.select(missing);
  await reloadIndicators();
  toast(`${missing.length} ${missing.length === 1 ? "acción agregada" : "acciones agregadas"} a la vista`, "ok");

  refreshManyInBackground(missing);
}

export async function clearView() {
  state.clearSelection();
  await reloadIndicators();
  toast("Vista vacía. Las acciones siguen cargadas en el sistema.", "info");
}

// ============ Sincronización ============

/**
 * Actualiza una acción. `silent` distingue el refresco automático de
 * fondo (aviso suave) del que pidió el usuario con el botón (error claro).
 * No recarga indicadores: cada llamador decide cuándo hacerlo, porque el
 * criterio cambia según el caso (refreshStock recarga todo al terminar;
 * refreshManyInBackground y syncVisible van fila por fila y cierran con
 * una recarga completa para la matriz).
 */
async function syncOne(symbol, { silent = false } = {}) {
  if (state.isSyncing(symbol)) return;

  state.markSyncing(symbol, true);
  try {
    const r = await api.addStock(symbol, intervalFor(state.getTimeframe()));
    state.applyQuote(symbol, r.live);
  } catch (err) {
    toast(
      silent
        ? `No se pudo actualizar ${symbol}; se muestran los últimos datos guardados`
        : `No se pudo actualizar ${symbol}: ${err.message}`,
      silent ? "info" : "error"
    );
  } finally {
    state.markSyncing(symbol, false);
  }
}

/** Botón ↻ de una fila. */
export async function refreshStock(stock) {
  await syncOne(stock.symbol);
  await reloadIndicators();
}

/**
 * Varios en segundo plano, uno por vez (nunca en paralelo: mismo
 * criterio serial que el resto de la app con Yahoo).
 *
 * Los indicadores se recalculan DOS veces por vuelta, a propósito:
 * reloadOneIndicator por símbolo completa esa fila apenas llegan sus
 * datos (request chico, de un solo símbolo), y el reloadIndicators del
 * final es el que repinta la matriz de ratios, que depende de todos los
 * pares y no se puede actualizar de a uno.
 */
async function refreshManyInBackground(symbols) {
  for (const sym of symbols) {
    await syncOne(sym, { silent: true });
    await reloadOneIndicator(sym);
  }
  await reloadIndicators();
}

// Candado del ciclo de actualización completo: evita que el auto-refresh
// se superponga con uno manual.
let syncBusy = false;

export const isSyncBusy = () => syncBusy;

/**
 * Re-sincroniza SÓLO las acciones visibles, en serie.
 * @param {{auto?: boolean}} opts  auto = disparada por el temporizador:
 *        sin toast de éxito, para no molestar en cada cruce de hora.
 */
export async function syncVisible({ auto = false } = {}) {
  if (syncBusy) return;

  const targets = state.getVisible();
  if (!targets.length) {
    if (!auto) toast("No hay acciones en la vista para actualizar", "info");
    return;
  }

  syncBusy = true;
  const btn = $("#sync-btn");
  if (btn) btn.disabled = true;
  const fails = [];

  try {
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      progress(`${auto ? "Actualización automática" : "Actualizando"} ${i + 1}/${targets.length}: ${s.symbol}…`);

      state.markSyncing(s.symbol, true);
      try {
        const r = await api.addStock(s.symbol, intervalFor(state.getTimeframe()));
        state.applyQuote(s.symbol, r.live);
        // La fila se completa apenas llegan sus datos, en vez de esperar
        // a que terminen todas: es un request chico, de un solo símbolo.
        await reloadOneIndicator(s.symbol);
      } catch {
        fails.push(s.symbol);
      } finally {
        state.markSyncing(s.symbol, false);
      }
    }

    if (fails.length) {
      toast(`Actualizado con errores en: ${fails.join(", ")}`, "error");
    } else if (!auto) {
      toast(`${targets.length} ${targets.length === 1 ? "acción actualizada" : "acciones actualizadas"}`, "ok");
    }
  } finally {
    await reloadIndicators();
    syncBusy = false;
    progressOff();
    if (btn) btn.disabled = false;
  }
}

// ============ Agregar ============

/**
 * Agrega acciones desde el input del aside. Acepta:
 *   - un símbolo:            AAPL
 *   - varios separados:      AAPL, MSFT NVDA
 *   - un par con barra:      AAPL/MSFT  (limpia la vista y deja esas dos)
 *
 * Las que ya están cargadas sólo se muestran (instantáneo); las nuevas
 * se descargan de a una, en serie, con progreso.
 */
export async function addStocks(rawInput) {
  const raw = String(rawInput ?? "").trim();
  if (!raw) return;

  // "AAPL/MSFT" = atajo para comparar dos acciones solas
  const pair = raw.match(/^([A-Za-z0-9.\-^=]+)\s*\/\s*([A-Za-z0-9.\-^=]+)$/);
  let text = raw;

  if (pair) {
    const [, a, b] = pair;
    text = `${a}, ${b}`;
    state.clearSelection();          // el par reemplaza la vista actual
  }

  const symbols = parseSymbols(text);
  if (!symbols.length) return;

  const catalog = state.getCatalog();
  const known = symbols.filter(sym => catalog.some(c => c.symbol === sym));
  const fresh = symbols.filter(sym => !known.includes(sym));

  // Lo ya cargado aparece al instante, sin esperar nada
  if (known.length) {
    state.select(known);
    await reloadIndicators();
  }

  if (!fresh.length) {
    toast(
      known.length === 1
        ? `${known[0]} ya estaba cargada: agregada a la vista`
        : `${known.length} acciones ya estaban cargadas: agregadas a la vista`,
      "info"
    );
    refreshManyInBackground(known);
    return;
  }

  const btn = $("#add-symbol-btn");
  if (btn) btn.disabled = true;

  const added = [];
  const fails = [];
  const quotes = new Map();

  try {
    for (let i = 0; i < fresh.length; i++) {
      const sym = fresh[i];
      overlay(
        fresh.length === 1
          ? `Agregando ${sym}\nDescargando histórico…`
          : `Agregando ${i + 1}/${fresh.length}: ${sym}\nDescargando histórico…`
      );

      try {
        const r = await api.addStock(sym, "1d");
        await api.addStock(sym, "1h");
        quotes.set(sym, r.live);
        added.push(sym);
      } catch (err) {
        fails.push(`${sym} (${err.message})`);
      }
    }

    if (added.length) {
      // Recarga del catálogo: las nuevas traen nombre, bolsa y demás
      state.setCatalog(await api.getStocks());
      for (const [sym, live] of quotes) state.applyQuote(sym, live);
      state.select(added);
    }
    await reloadIndicators();

  } finally {
    overlayOff();
    if (btn) btn.disabled = false;
  }

  const parts = [];
  if (added.length) {
    parts.push(added.length === 1 ? `${added[0]} agregada` : `${added.length} acciones agregadas`);
  }
  if (known.length) {
    parts.push(`${known.length} ya ${known.length === 1 ? "estaba" : "estaban"} cargada${known.length === 1 ? "" : "s"}`);
  }

  if (fails.length) {
    toast(`${parts.join(". ")}${parts.length ? ".\n" : ""}Fallaron: ${fails.join(", ")}`, "error");
  } else {
    toast(parts.join(". "), "ok");
  }

  // Sólo tiene sentido si hubo símbolos ya cargados: con la lista vacía
  // el loop no hace nada pero igual dispara un reloadIndicators de más.
  if (known.length) refreshManyInBackground(known);
}