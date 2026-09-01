// Frontend/js/actions/indicators.js
// Recarga de los valores calculados: los indicadores de la tabla y la
// matriz de ratios. Nada de esto está persistido en la base, así que hay
// que volver a pedirlo cada vez que cambian los datos (un sync), la
// vista (qué acciones se muestran) o el plazo.

import * as api from "../Client/apiClient.js";
import * as state from "../state.js";

/**
 * Valores de los indicadores activos para las acciones visibles.
 * Se le pasan los precios del momento para que el backend cierre el
 * período en curso: la base sólo guarda velas cerradas.
 */
async function reloadTableIndicators() {
  const symbols = state.getSelected();
  if (!symbols.length) return;

  const ids = state.getColumns();

  try {
    const rows = await api.getIndicators(
      symbols, state.getTimeframe(), ids, state.getLivePrices()
    );
    state.applyIndicators(rows);
  } catch {
    /* se conservan los valores previos: mejor un dato viejo que ninguno */
  }
}

/** Matriz del indicador elegido sobre los pares de acciones visibles. */
async function reloadMatrix() {
  const symbols = state.getSelected();

  if (symbols.length < 2) {
    state.setMatrix({ rows: [] });
    return;
  }

  try {
    const matrix = await api.getRatioMatrix(
      symbols, state.getTimeframe(), state.getMatrixIndicator(), state.getLivePrices()
    );
    state.setMatrix(matrix);
  } catch {
    /* se conserva la matriz anterior */
  }
}

/**
 * Recalcula todo lo que depende de los datos, la vista o el plazo.
 * Es el único punto de entrada: cualquier acción que cambie alguna de
 * esas tres cosas llama acá y no tiene que acordarse de qué recargar.
 * Las dos peticiones van en paralelo porque son independientes.
 */
export async function reloadIndicators() {
  await Promise.all([reloadTableIndicators(), reloadMatrix()]);
}

/** Catálogo de indicadores disponibles. Se pide una sola vez, al iniciar. */
export async function loadIndicatorMeta() {
  try {
    state.setIndicatorMeta(await api.getIndicatorMeta());
  } catch {
    state.setIndicatorMeta([]);
  }
}

/**
 * Indicadores de un solo símbolo. Se usa durante un ciclo de sync para
 * ir actualizando cada fila apenas llegan sus datos, en vez de esperar
 * a que terminen todas.
 */
export async function reloadOneIndicator(symbol) {
  try {
    const rows = await api.getIndicators(
      [symbol], state.getTimeframe(), state.getColumns(), state.getLivePrices()
    );
    state.mergeIndicators(rows);
  } catch {
    /* se conservan los valores previos */
  }
}