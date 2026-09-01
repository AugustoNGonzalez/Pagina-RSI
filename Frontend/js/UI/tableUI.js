// Frontend/js/UI/tableUI.js
// Render puro de la tabla principal. No hace fetch ni conoce el estado:
// recibe los datos ya armados y pinta.
//
// Las columnas de indicadores son dinámicas: se arman con la metadata
// que el backend expone en /api/indicators/meta, así agregar un
// indicador nuevo no requiere tocar este archivo.
//
// Estado propio (de presentación, no del dominio): criterio de orden y
// qué fila tiene abierta la confirmación de quitar. Vive acá para que
// sobreviva a los re-renders del auto-refresh.
// Contenedores que espera en index.html: #stock-table-head y
// #stock-table-body.

import { esc, fmt, fmtUpdated, fmtIndicator, indicatorStyle, zoneClass } from "./format.js";

// ---- Ordenamiento ----

const changePct = s =>
  (typeof s.lastPrice === "number" &&
   typeof s.previousClose === "number" && s.previousClose !== 0)
    ? ((s.lastPrice - s.previousClose) / s.previousClose) * 100
    : null;

// Accesores de las columnas fijas. Las de indicadores se agregan al
// vuelo con la clave "ind:<id>".
const BASE_ACCESSORS = {
  symbol: s => s.symbol,
  name:   s => s.longName ?? s.shortName ?? "",
  price:  s => s.lastPrice,
  change: changePct
};

function accessor(key) {
  if (key.startsWith("ind:")) {
    const id = key.slice(4);
    return s => s.values?.[id] ?? null;
  }
  return BASE_ACCESSORS[key];
}

let sortKey = null;      // null = orden default (tal como llegan)
let sortAsc = true;
let confirming = null;   // símbolo con la confirmación de quitar abierta

function sortStocks(stocks) {
  if (sortKey === null) return stocks;

  const get = accessor(sortKey);
  if (!get) return stocks;

  const dir = sortAsc ? 1 : -1;

  return [...stocks].sort((a, b) => {
    const va = get(a), vb = get(b);
    // Sin dato → siempre al final, sin importar la dirección
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string") return va.localeCompare(vb) * dir;
    return (va - vb) * dir;
  });
}

/**
 * Celda de acciones. Dos posiciones fijas, siempre del mismo ancho:
 *   normal:      muestra la hora; con hover, la hora se oculta y
 *                aparecen  [↻ actualizar] [✕ quitar]
 *   confirmando: [✕ cancelar] [✓ confirmar]  — el ✓ cae exactamente
 *                donde estaba el ✕ que se apretó.
 */
function actionsCell(s, syncing) {
  const sym = esc(s.symbol);

  if (confirming === s.symbol) {
    return `<td class="actions"><div class="actions-wrap">
      <button class="row-btn cancel" data-act="cancel" data-sym="${sym}"
              title="Cancelar">✕</button>
      <button class="row-btn confirm" data-act="confirm" data-sym="${sym}"
              title="Sí, quitar ${sym} de la vista">✓</button>
    </div></td>`;
  }

  const spin = syncing?.has(s.symbol) ? " spin" : "";
  return `<td class="actions"><div class="actions-wrap">
    <span class="upd">${fmtUpdated(s.updatedAt)}</span>
    <button class="row-btn refresh${spin}" data-act="refresh" data-sym="${sym}"
            title="Actualizar ${sym}">↻</button>
    <button class="row-btn hide" data-act="hide" data-sym="${sym}"
            title="Quitar ${sym} de la vista">✕</button>
  </div></td>`;
}

/**
 * Tabla principal: una fila por acción visible, ordenada según la
 * columna elegida.
 *
 * @param {Array} stocks   acciones a mostrar, con su objeto `values`
 * @param {{
 *   columns: Array<{id, label, scale, min?, max?, neutral?}>,  indicadores activos
 *   timeframe: string,
 *   syncing?: Set<string>,
 *   onHide: (stock) => void,
 *   onRefresh: (stock) => void
 * }} opts
 */
export function renderStockTable(stocks, opts = {}) {
  const { columns = [], timeframe = "1d", syncing, onHide, onRefresh } = opts;

  const thead = document.querySelector("#stock-table-head");
  const tbody = document.querySelector("#stock-table-body");

  const tfLabel = { "1h": "1H", "1d": "1D", "1wk": "1S" }[timeframe] ?? "";
  const arrow = k => (k === sortKey ? (sortAsc ? " ▲" : " ▼") : "");

  const indHeaders = columns.map(c =>
    `<th class="sortable num" data-key="ind:${esc(c.id)}">${esc(c.label)} ${tfLabel}${arrow(`ind:${c.id}`)}</th>`
  ).join("");

  thead.innerHTML = `<tr>
    <th class="sortable" data-key="symbol">Símbolo${arrow("symbol")}</th>
    <th class="sortable" data-key="name">Nombre${arrow("name")}</th>
    <th class="sortable num" data-key="price">Precio${arrow("price")}</th>
    <th class="sortable num" data-key="change">Var. día${arrow("change")}</th>
    ${indHeaders}
    <th class="actions-col">Actualizado</th>
  </tr>`;

  thead.querySelectorAll(".sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      // Ciclo por columna: default → ascendente → descendente → default
      if (key !== sortKey) { sortKey = key; sortAsc = true; }
      else if (sortAsc) { sortAsc = false; }
      else { sortKey = null; sortAsc = true; }
      renderStockTable(stocks, opts);
    });
  });

  const colCount = 5 + columns.length;

  if (!stocks.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty">
      Vista vacía. Escribí un símbolo para agregarlo, o usá «Agregar todas».</td></tr>`;
    return;
  }

  // La fila se resalta según el PRIMER indicador activo: con varias
  // columnas, resaltar por todas sería un semáforo ilegible.
  const zoneCol = columns[0];

  tbody.innerHTML = sortStocks(stocks).map(s => {
    const pct = changePct(s);
    let changeHtml = `<td class="num">—</td>`;
    if (pct != null) {
      const cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
      const sign = pct > 0 ? "+" : "";
      changeHtml = `<td class="num ${cls}">${sign}${pct.toFixed(2)}%</td>`;
    }

    const indCells = columns.map(c => {
      const v = s.values?.[c.id] ?? null;
      return `<td class="num ind-cell" style="${indicatorStyle(v, c)}">${fmtIndicator(v, c)}</td>`;
    }).join("");

    const zone = zoneCol ? zoneClass(s.values?.[zoneCol.id] ?? null, zoneCol) : "";

    return `<tr class="${zone}${confirming === s.symbol ? " confirming" : ""}">
      <td class="sym">${esc(s.symbol)}</td>
      <td class="name">${esc(s.longName ?? s.shortName ?? "")}${
        s.exchange ? ` <span class="exch">${esc(s.exchange)}</span>` : ""
      }</td>
      <td class="num">${fmt(s.lastPrice)}</td>
      ${changeHtml}
      ${indCells}
      ${actionsCell(s, syncing)}
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", () => {
      const stock = stocks.find(x => x.symbol === btn.dataset.sym);
      if (!stock) return;

      switch (btn.dataset.act) {
        case "refresh":
          onRefresh?.(stock);
          break;
        case "hide":                       // abre la confirmación
          confirming = stock.symbol;
          renderStockTable(stocks, opts);
          break;
        case "cancel":
          confirming = null;
          renderStockTable(stocks, opts);
          break;
        case "confirm":
          confirming = null;
          onHide?.(stock);                 // quien llama saca de la vista y repinta
          break;
      }
    });
  });
}