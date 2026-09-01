// Frontend/js/UI/settingsUI.js
// Panel de opciones (el engranaje del aside): eliminar acciones,
// administrar grupos y vaciar la base.
//
// A diferencia de los otros módulos de UI, este no es render puro: es
// una pantalla completa con su propio estado (qué grupo está elegido y
// sus miembros) y sus propias acciones. Vive acá para que no engorde
// app.js, que sólo tiene que abrirlo y cerrarlo.

import * as api from "../Client/apiClient.js";
import * as state from "../state.js";
import { toast, overlay, overlayOff } from "./notify.js";
import { esc, parseSymbols } from "./format.js";
import { reloadGroups } from "../actions/groups.js";
import { reloadIndicators } from "../actions/indicators.js";

const $ = sel => document.querySelector(sel);

// Miembros del grupo elegido en el panel. Estado local: sólo importa
// mientras el modal está abierto.
let groupMembers = [];

// ============ Abrir y cerrar ============

function openSettings() {
  renderSelects();
  $("#settings-modal").classList.add("show");
}

function closeSettings() {
  $("#settings-modal").classList.remove("show");
}

// ============ Render ============

function renderSelects() {
  const catalog = state.getCatalog();
  const groups = state.getGroups();

  $("#settings-stock-select").innerHTML = catalog.length
    ? catalog.map(s => `<option value="${s.stockId}">${esc(s.symbol)}</option>`).join("")
    : `<option value="">— sin acciones —</option>`;

  const gsel = $("#settings-group-select");
  const prev = gsel.value;                   // conserva la selección al re-renderizar
  gsel.innerHTML = groups.length
    ? groups.map(g => `<option value="${g.groupId}">${esc(g.groupName)}</option>`).join("")
    : `<option value="">— sin grupos —</option>`;
  if (prev && groups.some(g => String(g.groupId) === prev)) gsel.value = prev;

  loadMembers();
}

function renderMembers() {
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
    btn.addEventListener("click", () => removeMember(Number(btn.dataset.id)));
  });
}

/** Trae los miembros del grupo elegido (o limpia si no hay ninguno). */
async function loadMembers() {
  const groupId = Number($("#settings-group-select").value);

  if (!groupId) {
    groupMembers = [];
    renderMembers();
    return;
  }

  try {
    const g = await api.getGroup(groupId);
    groupMembers = g.members;
  } catch {
    groupMembers = [];
  }
  renderMembers();
}

// ============ Acciones ============

async function deleteStock() {
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

    // Sale del catálogo en memoria y de la vista. Se busca ANTES de
    // filtrar: después ya no estaría en el catálogo.
    const stock = state.getCatalog().find(c => c.stockId === stockId);
    state.setCatalog(state.getCatalog().filter(c => c.stockId !== stockId));
    if (stock) state.deselect(stock.symbol);

    await reloadIndicators();
    await reloadGroups();          // cambió el memberCount de sus grupos
    renderSelects();
    toast(`${symbol} eliminada`, "ok");

  } catch (err) {
    toast(err.message, "error");
  }
}

async function deleteGroup() {
  const sel = $("#settings-group-select");
  const groupId = Number(sel.value);
  if (!groupId) return;

  const name = sel.options[sel.selectedIndex].text;
  if (!confirm(`¿Eliminar el grupo "${name}"?\nLas acciones NO se borran, sólo la agrupación.`)) return;

  try {
    await api.deleteGroup(groupId);
    await reloadGroups();
    renderSelects();
    toast(`Grupo "${name}" eliminado`, "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function renameGroup() {
  const groupId = Number($("#settings-group-select").value);
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
    renderSelects();
    input.value = "";
    toast(`Grupo renombrado a "${name}"`, "ok");
  } catch (err) {
    toast(err.message, "error");   // 409 si el nombre ya existe
  }
}

async function removeMember(stockId) {
  const groupId = Number($("#settings-group-select").value);
  if (!groupId) return;

  const member = groupMembers.find(m => m.stockId === stockId);

  try {
    await api.removeStockFromGroup(groupId, stockId);
    groupMembers = groupMembers.filter(m => m.stockId !== stockId);
    renderMembers();
    await reloadGroups();          // cambió el memberCount
    toast(`${member?.symbol ?? "Acción"} sacada del grupo`, "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function addMembers() {
  const groupId = Number($("#settings-group-select").value);
  if (!groupId) {
    toast("Elegí un grupo primero", "error");
    return;
  }

  const input = $("#group-add-symbols");
  const symbols = parseSymbols(input.value);

  if (!symbols.length) {
    toast("Escribí al menos un símbolo", "error");
    return;
  }

  const btn = $("#group-add-btn");
  if (btn) btn.disabled = true;
  overlay(`Agregando ${symbols.length} ${symbols.length === 1 ? "acción" : "acciones"} al grupo…`);

  try {
    const r = await api.addStocksToGroup(groupId, symbols);

    const oks = r.results.filter(x => x.ok);
    const fails = r.results.filter(x => !x.ok);

    // Las nuevas traen nombre y bolsa: hay que releer el catálogo
    state.setCatalog(await api.getStocks());
    for (const x of oks) state.applyQuote(x.symbol, x.data.live);

    await reloadIndicators();
    await loadMembers();
    await reloadGroups();
    input.value = "";

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
    if (btn) btn.disabled = false;
  }
}

async function clearDatabase() {
  const catalog = state.getCatalog();
  const groups = state.getGroups();

  if (!confirm(
    `¿Vaciar la base de datos?\n\n` +
    `Se borran ${catalog.length} ${catalog.length === 1 ? "acción" : "acciones"} y ` +
    `${groups.length} ${groups.length === 1 ? "grupo" : "grupos"}, con todo su historial.\n\n` +
    `Esta acción NO se puede deshacer.`
  )) return;

  overlay("Vaciando la base de datos…");

  try {
    await api.clearAllData();
    state.setCatalog([]);
    state.clearSelection();
    await reloadGroups();
    await reloadIndicators();
    renderSelects();
    toast("Base de datos vacía", "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    overlayOff();
  }
}

// ============ Wiring ============

/** Cablea los controles del panel. Se llama una vez, al iniciar. */
export function bindSettings() {
  $("#settings-btn").addEventListener("click", openSettings);
  $("#settings-close").addEventListener("click", closeSettings);

  $("#settings-modal").addEventListener("click", e => {
    if (e.target.id === "settings-modal") closeSettings();   // click en el fondo
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeSettings();
  });

  $("#delete-stock-btn").addEventListener("click", deleteStock);

  $("#settings-group-select").addEventListener("change", loadMembers);
  $("#delete-group-btn").addEventListener("click", deleteGroup);
  $("#rename-group-btn").addEventListener("click", renameGroup);
  $("#group-add-btn").addEventListener("click", addMembers);
  $("#group-add-symbols").addEventListener("keydown", e => {
    if (e.key === "Enter") addMembers();
  });

  $("#clear-db-btn").addEventListener("click", clearDatabase);
}