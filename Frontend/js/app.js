// Frontend/js/app.js
// Orquestador: mantiene el estado (catálogo, grupos, selección, matriz),
// cablea los controles del aside y del panel de opciones con el
// apiClient, y decide cuándo se repinta.
// Los módulos UI sólo pintan; el apiClient sólo transporta; los avisos
// (toast/overlay/progress) viven en UI/notify.js.

import * as api from "./Client/apiClient.js";
import { renderStockTable } from "./UI/tableUI.js";
import { renderMatrix } from "./UI/matrixUI.js";
import { toast, overlay, overlayOff, progress, progressOff } from "./UI/notify.js";
import { applyTheme, savedTheme, toggleTheme, applyAside, savedAsideHidden, toggleAside } from "./UI/theme.js";
import { esc } from "./UI/format.js";
import { AUTO_REFRESH_MS, AUTO_CHECK_MS, SELECTED_KEY, TIMEFRAME_KEY, DEFAULT_TIMEFRAME } from "./config.js";

// ============ Estado ============

let catalog = [];            // todo lo cargado en la base
let groups = [];
let groupMembers = [];   // miembros del grupo elegido en el panel de opciones
let ratioMatrix = { rows: [] };
const selected = new Set();  // símbolos visibles en la tabla
const syncing = new Set();

const $ = sel => document.querySelector(sel);

// Auto-refresh: se dispara cuando pasaron AUTO_REFRESH_MS desde la última
// actualización (manual o automática) Y el mercado está abierto.
let lastRefreshAt = 0;
let syncBusy = false;

// Plazo activo del selector: aplica a la columna RSI de la tabla y a la
// matriz. Se guarda por navegador, como la selección y el tema.
let timeframe = localStorage.getItem(TIMEFRAME_KEY) ?? DEFAULT_TIMEFRAME;

// Horario de la sesión regular de NYSE/NASDAQ (9:30–16:00 hora de Nueva
// York), calculado en el huso del mercado para que el horario de verano
// se ajuste solo. No contempla feriados: sincronizar un feriado es
// inofensivo (Yahoo devuelve lo mismo), sólo gasta un par de requests.
function isMarketOpen() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());

  const get = t => parts.find(p => p.type === t)?.value;
  const day = get("weekday");
  if (day === "Sat" || day === "Sun") return false;

  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function startAutoRefresh() {
  setInterval(() => {
    if (syncBusy) return;
    if (!isMarketOpen()) return;
    if (Date.now() - lastRefreshAt < AUTO_REFRESH_MS) return;
    if (!visible().length) return;
    syncVisible({ auto: true });
  }, AUTO_CHECK_MS);
}

const visible = () => catalog.filter(s => selected.has(s.symbol));

// ============ Persistencia de la selección ============

function loadSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(SELECTED_KEY));
    if (Array.isArray(raw)) return raw;
  } catch { /* JSON corrupto: se ignora */ }
  return null;
}

function saveSelection() {
  localStorage.setItem(SELECTED_KEY, JSON.stringify([...selected]));
}

// ============ Render ============

function render() {
  renderStockTable(visible(), { syncing, onHide, onRefresh: onRefreshOne, timeframe });
  renderMatrix(ratioMatrix, [...selected]);
}

function renderGroupOptions() {
  $("#group-select").innerHTML =
    `<option value="">— Grupos —</option>` + groups.map(g =>
      `<option value="${g.groupId}">${esc(g.groupName)} (${g.memberCount})</option>`
    ).join("");
}

function renderSettingsSelects() {
  $("#settings-stock-select").innerHTML = catalog.length
    ? catalog.map(s => `<option value="${s.stockId}">${esc(s.symbol)}</option>`).join("")
    : `<option value="">— sin acciones —</option>`;

  const gsel = $("#settings-group-select");
  const prev = gsel.value;                   // conserva la selección al re-renderizar
  gsel.innerHTML = groups.length
    ? groups.map(g => `<option value="${g.groupId}">${esc(g.groupName)}</option>`).join("")
    : `<option value="">— sin grupos —</option>`;
  if (prev && groups.some(g => String(g.groupId) === prev)) gsel.value = prev;

  loadGroupMembers();
}

// Miembros del grupo seleccionado en el panel, cada uno con su ✕
function renderGroupMembers() {
  const ul = $("#group-members");

  if (!groupMembers.length) {
    ul.innerHTML = `<li class="empty">Sin acciones en este grupo</li>`;
    return;
  }

  ul.innerHTML = groupMembers.map(m => `
    <li>
      <span>${esc(m.symbol)}</span>
      <button class="member-del" data-id="${m.stockId}"
              title="Sacar ${esc(m.symbol)} del grupo">✕</button>
    </li>`).join("");

  ul.querySelectorAll(".member-del").forEach(btn => {
    btn.addEventListener("click", () => onRemoveMember(Number(btn.dataset.id)));
  });
}

// Trae los miembros del grupo elegido (o limpia si no hay ninguno)
async function loadGroupMembers() {
  const groupId = Number($("#settings-group-select").value);
  if (!groupId) {
    groupMembers = [];
    renderGroupMembers();
    return;
  }

  try {
    const g = await api.getGroup(groupId);
    groupMembers = g.members;
  } catch {
    groupMembers = [];
  }
  renderGroupMembers();
}

// ============ Helpers de estado ============

function applyLive(symbol, live) {
  const s = catalog.find(c => c.symbol === symbol);
  if (!s || !live) return;
  if (typeof live.price === "number") s.lastPrice = live.price;
  if (typeof live.previousClose === "number") s.previousClose = live.previousClose;
  if (typeof live.rsi === "number") s.rsi = live.rsi;
  s.updatedAt = new Date().toISOString();
}

async function reloadCatalog() {
  const stocks = await api.getStocks();
  const prevRSI = new Map(catalog.map(c => [c.symbol, c.rsi]));
  catalog = stocks.map(s => ({ ...s, rsi: prevRSI.get(s.symbol) ?? null }));
}

async function reloadGroups() {
  groups = await api.getGroups();
  renderGroupOptions();
}

// El RSI del plazo activo se calcula al vuelo en el backend (sólo el
// diario está persistido). Se pide junto con la matriz tras cada cambio
// de datos o de plazo.
async function reloadTimeframeRSI() {
  const syms = [...selected];
  if (!syms.length) return;
  try {
    const rows = await api.getRSIByTimeframe(syms, timeframe, livePrices());
    const bySym = new Map(rows.map(r => [r.symbol, r.rsi]));
    for (const s of catalog) {
      if (bySym.has(s.symbol)) s.rsi = bySym.get(s.symbol);
    }
  } catch { /* se conservan los valores previos */ }
}

async function reloadRatioMatrix() {
  const syms = [...selected];
  if (syms.length < 2) { ratioMatrix = { rows: [] }; return; }
  try {
    ratioMatrix = await api.getRatioMatrix(livePrices(), syms, timeframe);
  } catch { /* se conserva la anterior */ }
}

// Recalcula todo lo que depende del plazo. Reemplaza a las llamadas
// sueltas a reloadRatioMatrix en los handlers que cambian datos o vista.
async function reloadIndicators() {
  await Promise.all([reloadTimeframeRSI(), reloadRatioMatrix()]);
}

// Precios vivos que ya tenemos en memoria, para que la matriz de ratios
// incluya la vela en curso (StockPrices sólo tiene velas completadas).
function livePrices() {
  const out = {};
  for (const s of catalog) {
    if (typeof s.lastPrice === "number") out[s.symbol] = s.lastPrice;
  }
  return out;
}

// ============ Arranque ============

async function init() {
  bindEvents();
  applyAside(savedAsideHidden());
  applyTheme(savedTheme());
  renderTimeframeButtons();
  progress("Cargando…");

  try {
    const [stocks, rsis, grps] = await Promise.all([
      api.getStocks(), api.getRSIMatrix(), api.getGroups()
    ]);

    const rsiBySym = new Map(rsis.map(r => [r.symbol, r.rsi]));
    catalog = stocks.map(s => ({ ...s, rsi: rsiBySym.get(s.symbol) ?? null }));
    groups = grps;

    const saved = loadSelection();
    selected.clear();
    if (saved) {
      for (const sym of saved) {
        if (catalog.some(c => c.symbol === sym)) selected.add(sym);
      }
    } else {
      for (const c of catalog) selected.add(c.symbol);
    }
    saveSelection();

    await reloadIndicators();

    renderGroupOptions();
    render();
    startAutoRefresh();

  } catch (err) {
    toast(err.message, "error");
  } finally {
    progressOff();
  }
}

// ============ Vista ============

// El tema cambia los gradientes, que son estilos inline: hay que
// repintar la tabla y la matriz con la paleta nueva.
function onToggleTheme() {
  toggleTheme();
  render();
}

// ✕ de la fila: saca la acción de la VISTA (sigue cargada en el sistema;
// para borrarla de verdad está el panel de opciones).
async function onHide(stock) {
  selected.delete(stock.symbol);
  saveSelection();
  await reloadIndicators();
  render();
}

async function onAddAll() {
  const missing = catalog.filter(c => !selected.has(c.symbol));
  if (!missing.length) {
    toast("Ya están todas en la vista", "info");
    return;
  }
  for (const c of missing) selected.add(c.symbol);
  saveSelection();
  await reloadIndicators();
  render();
  toast(`${missing.length} ${missing.length === 1 ? "acción agregada" : "acciones agregadas"} a la vista`, "ok");
  refreshManyInBackground(missing.map(c => c.symbol));
}

async function onClear() {
  selected.clear();
  saveSelection();
  await reloadIndicators();
  render();
  toast("Vista vacía. Las acciones siguen cargadas en el sistema.", "info");
}

async function onTimeframeChange(tf) {
  if (tf === timeframe) return;
  timeframe = tf;
  localStorage.setItem(TIMEFRAME_KEY, tf);
  renderTimeframeButtons();
  progress(`Calculando RSI ${tf === "1wk" ? "semanal" : tf === "1h" ? "por hora" : "diario"}…`);
  await reloadIndicators();
  render();
  progressOff();
}

function renderTimeframeButtons() {
  document.querySelectorAll("#timeframe button").forEach(b => {
    b.classList.toggle("active", b.dataset.tf === timeframe);
  });
}

// ============ Acciones ============

// Actualiza una acción. `silent` distingue el refresco automático de
// fondo (aviso suave) del que pidió el usuario con el botón (error claro).
async function refreshOne(symbol, { silent = false } = {}) {
  if (syncing.has(symbol)) return;
  syncing.add(symbol);
  render();                                   // el ↻ de esa fila empieza a girar
  try {
    const r = await api.addStock(symbol);
    applyLive(symbol, r.live);
  } catch (err) {
    toast(
      silent
        ? `No se pudo actualizar ${symbol}; se muestran los últimos datos guardados`
        : `No se pudo actualizar ${symbol}: ${err.message}`,
      silent ? "info" : "error"
    );
  } finally {
    syncing.delete(symbol);
    render();
  }
}

// Botón ↻ de una fila: actualiza esa acción y recalcula los indicadores.
const onRefreshOne = async stock => {
  await refreshOne(stock.symbol);
  await reloadIndicators();
  render();
};

// Varios en segundo plano, uno por vez (nunca en paralelo: mismo
// criterio serial que el resto de la app con Yahoo). 
// Los indicadores se recalculan UNA vez al final
async function refreshManyInBackground(symbols) {
  for (const sym of symbols) await refreshOne(sym, { silent: true });
  await reloadIndicators();
  render();
}

// Acepta uno o varios símbolos separados por coma, espacio o punto y
// coma. Los que ya están cargados sólo se muestran (instantáneo); los
// nuevos se descargan de a uno, en serie, con progreso.
async function onAddStock() {
  const input = $("#add-symbol-input");
  const raw = input.value.trim();

  // "AAPL/MSFT" = atajo para comparar dos acciones solas: limpia la
  // vista y deja sólo ese par (equivale a un grupo de dos).
  const pair = raw.match(/^([A-Za-z0-9.\-^=]+)\s*\/\s*([A-Za-z0-9.\-^=]+)$/);
  if (pair) {
    const [, a, b] = pair;
    input.value = `${a.toUpperCase()}, ${b.toUpperCase()}`;
    selected.clear();                 // el par reemplaza la vista actual
    saveSelection();
  }

  const symbols = [...new Set(
    input.value.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
  )];
  if (!symbols.length) return;

  const known = symbols.filter(sym => catalog.some(c => c.symbol === sym));
  const fresh = symbols.filter(sym => !known.includes(sym));

  if (known.length) {
    for (const sym of known) selected.add(sym);
    saveSelection();
    await reloadIndicators();
    render();
  }

  input.value = "";

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
  btn.disabled = true;

  const added = [];
  const fails = [];
  const lives = new Map();

  try {
    for (let i = 0; i < fresh.length; i++) {
      const sym = fresh[i];
      overlay(
        fresh.length === 1
          ? `Agregando ${sym}\nDescargando 5 años de histórico…`
          : `Agregando ${i + 1}/${fresh.length}: ${sym}\nDescargando 5 años de histórico…`
      );

      try {
        const r = await api.addStock(sym);
        lives.set(sym, r.live);
        added.push(sym);
      } catch (err) {
        fails.push(`${sym} (${err.message})`);
      }
    }

    if (added.length) {
      await reloadCatalog();
      for (const [sym, live] of lives) applyLive(sym, live);
      for (const sym of added) selected.add(sym);
      saveSelection();
    }
    await reloadIndicators();
    render();

  } finally {
    overlayOff();
    btn.disabled = false;
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

  refreshManyInBackground(known);
}

// Re-sincroniza SÓLO las visibles, en serie. `auto` = disparada por el
// temporizador: sin toast de éxito para no molestar cada 12 minutos.
async function syncVisible({ auto = false } = {}) {
  if (syncBusy) return;

  const targets = visible();
  if (!targets.length) {
    if (!auto) toast("No hay acciones en la vista para actualizar", "info");
    return;
  }

  syncBusy = true;
  const btn = $("#sync-btn");
  btn.disabled = true;
  const fails = [];

  try {
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      progress(`${auto ? "Actualización automática" : "Actualizando"} ${i + 1}/${targets.length}: ${s.symbol}…`);
      syncing.add(s.symbol);
      render();
      try {
        const r = await api.addStock(s.symbol);
        applyLive(s.symbol, r.live);
      } catch {
        fails.push(s.symbol);
      } finally {
        syncing.delete(s.symbol);
        render();
      }
    }

    if (fails.length) {
      toast(`Actualizado con errores en: ${fails.join(", ")}`, "error");
    } else if (!auto) {
      toast(`${targets.length} ${targets.length === 1 ? "acción actualizada" : "acciones actualizadas"}`, "ok");
    }
  } finally {
    await reloadIndicators();
    render();
    lastRefreshAt = Date.now();
    syncBusy = false;
    progressOff();
    btn.disabled = false;
  }
}

// ============ Grupos ============

async function onViewGroup() {
  const groupId = Number($("#group-select").value);
  if (!groupId) return;

  try {
    const g = await api.getGroup(groupId);
    selected.clear();
    for (const m of g.members) selected.add(m.symbol);
    saveSelection();
    await reloadIndicators();
    render();
    toast(`Viendo grupo "${g.groupName}" (${g.members.length} acciones)`, "info");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function onCreateGroup() {
  const name = $("#new-group-name").value.trim();
  const raw = $("#new-group-symbols").value;
  const symbols = raw.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);

  if (!name) {
    toast("El grupo necesita un nombre", "error");
    return;
  }

  const btn = $("#create-group-btn");
  btn.disabled = true;
  overlay(
    symbols.length
      ? `Creando grupo "${name}"\nSincronizando ${symbols.length} acciones…`
      : `Creando grupo "${name}"…`
  );

  try {
    const r = await api.createGroup(name, symbols);

    await reloadCatalog();
    const oks = r.results.filter(x => x.ok);
    const fails = r.results.filter(x => !x.ok);

    for (const x of oks) applyLive(x.symbol, x.data.live);

    if (oks.length) {
      selected.clear();
      for (const x of oks) selected.add(x.symbol);
      saveSelection();
    }
    await reloadIndicators();
    render();
    await reloadGroups();

    if (fails.length) {
      toast(
        `Grupo "${name}" creado con ${oks.length} acciones.\nFallaron: ` +
        fails.map(x => `${x.symbol} (${x.error})`).join(", "),
        "error"
      );
    } else {
      toast(`Grupo "${name}" creado (${oks.length} acciones)`, "ok");
    }

    $("#new-group-name").value = "";
    $("#new-group-symbols").value = "";

  } catch (err) {
    toast(err.message, "error");
  } finally {
    overlayOff();
    btn.disabled = false;
  }
}

// ============ Panel de opciones ============

function openSettings() {
  renderSettingsSelects();
  $("#settings-modal").classList.add("show");
}

function closeSettings() {
  $("#settings-modal").classList.remove("show");
}

async function onDeleteStock() {
  const sel = $("#settings-stock-select");
  const stockId = Number(sel.value);
  if (!stockId) return;

  const symbol = sel.options[sel.selectedIndex].text;
  if (!confirm(
    `¿Eliminar ${symbol}?\n\n` +
    `Se borra su historial guardado y sale de todos los grupos.\n` +
    `(Se puede volver a agregar después: re-descarga todo de Yahoo.)`
  )) return;

  try {
    await api.deleteStock(stockId);

    // El símbolo sale del catálogo en memoria y de la vista. Se busca
    // ANTES de filtrar: después ya no estaría en catalog.
    const stock = catalog.find(c => c.stockId === stockId);
    catalog = catalog.filter(c => c.stockId !== stockId);
    if (stock) selected.delete(stock.symbol);

    saveSelection();
    await reloadIndicators();
    render();
    await reloadGroups();
    renderSettingsSelects();
    toast(`${symbol} eliminada`, "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function onDeleteGroup() {
  const sel = $("#settings-group-select");
  const groupId = Number(sel.value);
  if (!groupId) return;

  const name = sel.options[sel.selectedIndex].text;
  if (!confirm(`¿Eliminar el grupo "${name}"?\nLas acciones NO se borran, sólo la agrupación.`)) return;

  try {
    await api.deleteGroup(groupId);
    await reloadGroups();
    renderSettingsSelects();
    toast(`Grupo "${name}" eliminado`, "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function onRenameGroup() {
  const sel = $("#settings-group-select");
  const groupId = Number(sel.value);
  if (!groupId) return;

  const input = $("#rename-group-input");
  const name = input.value.trim();
  if (!name) {
    toast("Escribí el nuevo nombre", "error");
    return;
  }

  try {
    await api.renameGroup(groupId, name);
    await reloadGroups();
    renderSettingsSelects();
    input.value = "";
    toast(`Grupo renombrado a "${name}"`, "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function onClearDatabase() {
  if (!confirm(
    `¿Vaciar la base de datos?\n\n` +
    `Se borran ${catalog.length} ${catalog.length === 1 ? "acción" : "acciones"} y ` +
    `${groups.length} ${groups.length === 1 ? "grupo" : "grupos"}, con todo su historial.\n\n` +
    `Esta acción NO se puede deshacer.`
  )) return;

  overlay("Vaciando la base de datos…");

  try {
    await api.clearAllData();
    catalog = [];
    selected.clear();
    saveSelection();
    await reloadGroups();
    await reloadIndicators();
    render();
    renderSettingsSelects();
    toast("Base de datos vacía", "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    overlayOff();
  }
}

async function onRemoveMember(stockId) {
  const groupId = Number($("#settings-group-select").value);
  if (!groupId) return;

  const member = groupMembers.find(m => m.stockId === stockId);

  try {
    await api.removeStockFromGroup(groupId, stockId);
    groupMembers = groupMembers.filter(m => m.stockId !== stockId);
    renderGroupMembers();
    await reloadGroups();                    // cambió el memberCount
    toast(`${member?.symbol ?? "Acción"} sacada del grupo`, "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function onAddMembers() {
  const groupId = Number($("#settings-group-select").value);
  if (!groupId) {
    toast("Elegí un grupo primero", "error");
    return;
  }

  const input = $("#group-add-symbols");
  const symbols = [...new Set(
    input.value.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
  )];

  if (!symbols.length) {
    toast("Escribí al menos un símbolo", "error");
    return;
  }

  const btn = $("#group-add-btn");
  btn.disabled = true;
  overlay(`Agregando ${symbols.length} ${symbols.length === 1 ? "acción" : "acciones"} al grupo…`);

  try {
    const r = await api.addStocksToGroup(groupId, symbols);

    await reloadCatalog();
    for (const x of r.results.filter(x => x.ok)) applyLive(x.symbol, x.data.live);
    await reloadIndicators();
    render();

    await loadGroupMembers();
    await reloadGroups();
    input.value = "";

    const oks = r.results.filter(x => x.ok);
    const fails = r.results.filter(x => !x.ok);

    if (fails.length) {
      toast(
        `${oks.length} ${oks.length === 1 ? "acción agregada" : "acciones agregadas"} al grupo.\n` +
        `Fallaron: ` + fails.map(x => `${x.symbol} (${x.error})`).join(", "),
        "error"
      );
    } else {
      toast(`${oks.length} ${oks.length === 1 ? "acción agregada" : "acciones agregadas"} al grupo`, "ok");
    }

  } catch (err) {
    toast(err.message, "error");
  } finally {
    overlayOff();
    btn.disabled = false;
  }
}

// ============ Wiring ============

function bindEvents() {
  $("#add-symbol-btn").addEventListener("click", onAddStock);
  $("#add-symbol-input").addEventListener("keydown", e => {
    if (e.key === "Enter") onAddStock();
  });

  $("#sync-btn").addEventListener("click", () => syncVisible());
  $("#add-all-btn").addEventListener("click", onAddAll);
  $("#clear-btn").addEventListener("click", onClear);

  $("#group-select").addEventListener("change", onViewGroup);
  $("#create-group-btn").addEventListener("click", onCreateGroup);

  $("#settings-btn").addEventListener("click", openSettings);
  $("#settings-close").addEventListener("click", closeSettings);
  $("#settings-modal").addEventListener("click", e => {
    if (e.target.id === "settings-modal") closeSettings();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeSettings();
  });

  $("#theme-btn").addEventListener("click", onToggleTheme);
  $("#delete-stock-btn").addEventListener("click", onDeleteStock);
  $("#delete-group-btn").addEventListener("click", onDeleteGroup);
  $("#rename-group-btn").addEventListener("click", onRenameGroup);
  $("#clear-db-btn").addEventListener("click", onClearDatabase);

  document.querySelectorAll("#timeframe button").forEach(b => {
    b.addEventListener("click", () => onTimeframeChange(b.dataset.tf));
  });

  $("#settings-group-select").addEventListener("change", loadGroupMembers);
  $("#group-add-btn").addEventListener("click", onAddMembers);
  $("#group-add-symbols").addEventListener("keydown", e => {
    if (e.key === "Enter") onAddMembers();
  });

  $("#aside-toggle").addEventListener("click", toggleAside);
}

init();