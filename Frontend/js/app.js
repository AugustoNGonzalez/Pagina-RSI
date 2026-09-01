// Frontend/js/app.js
// Punto de entrada: arranca la app, cablea los controles del aside y
// mantiene la pantalla sincronizada con el estado.
//
// Todo lo demás vive en otros módulos: el estado en state.js, las
// operaciones en actions/, el dibujo en UI/, y el transporte en
// Client/apiClient.js. Acá sólo queda el arranque y el wiring.

import * as api from "./Client/apiClient.js";
import * as state from "./state.js";

import { renderStockTable } from "./UI/tableUI.js";
import { renderMatrix } from "./UI/matrixUI.js";
import { toast, progress, progressOff } from "./UI/notify.js";
import { esc } from "./UI/format.js";
import {
  applyTheme, savedTheme, toggleTheme,
  applyAside, savedAsideHidden, toggleAside
} from "./UI/theme.js";
import { bindSettings } from "./UI/settingsUI.js";

import { reloadIndicators, loadIndicatorMeta } from "./actions/indicators.js";
import { addStocks, hideStock, showAll, clearView, refreshStock, syncVisible } from "./actions/stocks.js";
import { viewGroup, createGroup } from "./actions/groups.js";
import { startAutoRefresh, isMarketOpen } from "./actions/autoRefresh.js";

import { TIMEFRAMES, DEFAULT_INDICATOR } from "./config.js";

const $ = sel => document.querySelector(sel);

// ============ Render ============

/** Metadata de los indicadores que están como columnas de la tabla. */
function activeColumns() {
  const meta = state.getIndicatorMeta();
  return state.getColumns()
    .map(id => meta.find(m => m.id === id))
    .filter(Boolean);
}

/** Metadata del indicador que se muestra en la matriz. */
function matrixIndicator() {
  const meta = state.getIndicatorMeta();
  return meta.find(m => m.id === state.getMatrixIndicator())
    ?? meta.find(m => m.id === DEFAULT_INDICATOR)
    ?? meta[0];
}

/**
 * Repinta todo. Está suscripto al estado, así que corre solo ante
 * cualquier cambio: ningún handler tiene que acordarse de llamarlo.
 */
function render() {
  renderStockTable(state.getVisible(), {
    columns: activeColumns(),
    timeframe: state.getTimeframe(),
    syncing: state.getSyncing(),
    onHide: hideStock,
    onRefresh: refreshStock
  });

  renderMatrix(state.getMatrix(), {
    visibleSymbols: state.getSelected(),
    indicator: matrixIndicator()
  });

  renderGroupOptions();
  renderTimeframeButtons();
}

function renderGroupOptions() {
  const sel = $("#group-select");
  const prev = sel.value;

  sel.innerHTML = `<option value="">— Grupos —</option>` +
    state.getGroups().map(g =>
      `<option value="${g.groupId}">${esc(g.groupName)} (${g.memberCount})</option>`
    ).join("");

  if (prev && state.getGroups().some(g => String(g.groupId) === prev)) sel.value = prev;
}

function renderTimeframeButtons() {
  const active = state.getTimeframe();
  document.querySelectorAll("#timeframe button").forEach(b => {
    b.classList.toggle("active", b.dataset.tf === active);
  });
}

// ============ Handlers del aside ============

async function onTimeframeChange(tf) {
  if (tf === state.getTimeframe()) return;

  const name = TIMEFRAMES.find(t => t.id === tf)?.name ?? tf;
  state.setTimeframe(tf);

  // Primero se muestran los indicadores del plazo nuevo con lo que ya
  // hay guardado (instantáneo), y después se sincroniza para traer los
  // datos del momento en esa granularidad.
  progress(`Calculando indicadores (${name})…`);
  try {
    await reloadIndicators();
  } finally {
    progressOff();
  }

  if (isMarketOpen()) syncVisible({ auto: true });
}

function onToggleTheme() {
  toggleTheme();
  render();   // los gradientes son estilos inline: hay que repintarlos
}

function onAddStock() {
  const input = $("#add-symbol-input");
  const value = input.value;
  input.value = "";
  addStocks(value);
}

function onCreateGroup() {
  createGroup($("#new-group-name").value, $("#new-group-symbols").value);
}

// ============ Wiring ============

function bindEvents() {
  $("#add-symbol-btn").addEventListener("click", onAddStock);
  $("#add-symbol-input").addEventListener("keydown", e => {
    if (e.key === "Enter") onAddStock();
  });

  $("#sync-btn").addEventListener("click", () => syncVisible());
  $("#add-all-btn").addEventListener("click", showAll);
  $("#clear-btn").addEventListener("click", clearView);

  $("#group-select").addEventListener("change", e => viewGroup(Number(e.target.value)));
  $("#create-group-btn").addEventListener("click", onCreateGroup);

  document.querySelectorAll("#timeframe button").forEach(b => {
    b.addEventListener("click", () => onTimeframeChange(b.dataset.tf));
  });

  $("#theme-btn").addEventListener("click", onToggleTheme);
  $("#aside-toggle").addEventListener("click", toggleAside);

  bindSettings();
}

// ============ Arranque ============

async function init() {
  bindEvents();
  state.subscribe(render);          // de acá en más, el estado repinta solo

  applyAside(savedAsideHidden());
  applyTheme(savedTheme());
  progress("Cargando…");

  try {
    // El catálogo de indicadores define las columnas, así que va primero
    await loadIndicatorMeta();

    const [stocks, groups] = await Promise.all([api.getStocks(), api.getGroups()]);
    state.setCatalog(stocks);
    state.setGroups(groups);

    state.restoreSelection();       // necesita el catálogo ya cargado
    await reloadIndicators();       // y la selección ya restaurada

    startAutoRefresh();

    // Al abrir, lo que se muestra es el último sync guardado: puede ser
    // de horas atrás. Si el mercado está abierto se actualiza en segundo
    // plano, así la página aparece al instante con lo que hay y los
    // números se refrescan solos en unos segundos. Sin await a propósito.
    if (isMarketOpen()) syncVisible({ auto: true });

  } catch (err) {
    toast(err.message, "error");
  } finally {
    progressOff();
  }
}

init();