// Frontend/js/UI/matrixUI.js
// Render puro de la matriz comparativa de ratios.
// Celda (fila, columna) = RSI de la serie fila/columna (el precio de una
// dividido el de la otra, vela a vela). Es lo mismo que ver "AAPL/MSFT"
// en TradingView con un RSI encima.
// NO es espejada: RSI(B/A) no es el complemento de RSI(A/B).
// El color usa el mismo gradiente que la tabla: rojo = el ratio está
// sobrecomprado (la fila viene fuerte contra la columna), verde = lo
// contrario.
// Contenedor que espera en index.html: #matrix-container.

import { esc, rsiStyle } from "./format.js";

/**
 * @param {{rows: Array<{symbol, cells}>}} matrix
 *        Ya viene filtrada por el backend a los símbolos pedidos.
 * @param {string[]} visibleSymbols
 *        Red de seguridad: descarta filas que hayan quedado de un
 *        estado anterior si la matriz y la selección se desincronizan.
 */
export function renderMatrix(matrix, visibleSymbols) {
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
      if (!cell || typeof cell.rsi !== "number") {
        return `<td class="no-data" title="Sin suficientes velas en común">—</td>`;
      }

      const tip = `RSI de ${row.symbol}/${colSym} — ${cell.points} velas en común`;
      return `<td style="${rsiStyle(cell.rsi)}" title="${esc(tip)}">${cell.rsi.toFixed(1)}</td>`;
    }).join("");

    return `<tr><th>${esc(row.symbol)}</th>${cells}</tr>`;
  }).join("");

  container.innerHTML = `
    <table class="rsi-matrix">
      <thead><tr><th class="corner">fila / col</th>${headers}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}