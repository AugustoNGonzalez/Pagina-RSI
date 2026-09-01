// Frontend/js/UI/matrixUI.js
// Render puro de la matriz comparativa de ratios.
// Celda (fila, columna) = el indicador elegido aplicado a la serie
// fila/columna (el precio de una dividido el de la otra, vela a vela).
// Es lo mismo que ver "AAPL/MSFT" en TradingView con ese indicador
// encima.
// NO es espejada: el valor de B/A no es el complemento del de A/B.
// El color usa el mismo gradiente que la tabla, según la escala que
// declara el indicador.
// Contenedor que espera en index.html: #matrix-container.

import { esc, fmtIndicator, indicatorStyle } from "./format.js";

/**
 * @param {{rows: Array<{symbol, cells: Array<{symbol, value, points}>}>}} matrix
 *        Ya viene filtrada por el backend a los símbolos pedidos.
 * @param {{
 *   visibleSymbols: string[],   red de seguridad si la matriz y la
 *                               selección quedaran desincronizadas
 *   indicator: {id, label, scale, min?, max?, neutral?}
 * }} opts
 */
export function renderMatrix(matrix, opts = {}) {
  const { visibleSymbols = [], indicator } = opts;
  const container = document.querySelector("#matrix-container");

  const show = new Set(visibleSymbols);
  const rows = (matrix?.rows ?? []).filter(r => show.has(r.symbol));

  if (rows.length < 2) {
    container.innerHTML = `<p class="empty">
      Se necesitan al menos 2 acciones con histórico para comparar.</p>`;
    return;
  }

  const cols = rows.map(r => r.symbol);
  const headers = cols.map(sym => `<th>${esc(sym)}</th>`).join("");

  const body = rows.map(row => {
    const byCol = new Map(row.cells.map(c => [c.symbol, c]));

    const cells = cols.map(colSym => {
      if (colSym === row.symbol) return `<td class="diag"></td>`;

      const cell = byCol.get(colSym);
      if (!cell || cell.value == null) {
        return `<td class="no-data" title="Sin suficientes velas en común">—</td>`;
      }

      const label = indicator?.label ?? "";
      const tip = `${label} de ${row.symbol}/${colSym} — ${cell.points} velas en común`;

      return `<td style="${indicatorStyle(cell.value, indicator)}" title="${esc(tip)}">${
        fmtIndicator(cell.value, indicator)
      }</td>`;
    }).join("");

    return `<tr><th>${esc(row.symbol)}</th>${cells}</tr>`;
  }).join("");

  container.innerHTML = `
    <table class="rsi-matrix">
      <thead><tr><th class="corner">fila / col</th>${headers}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}