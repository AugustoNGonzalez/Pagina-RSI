// Frontend/js/actions/groups.js
// Acciones de grupos que viven en el aside: ver un grupo (cargar sus
// acciones en la vista) y crear uno nuevo. La administración —renombrar,
// borrar, editar miembros— está en el panel de opciones (settingsUI).

import * as api from "../Client/apiClient.js";
import * as state from "../state.js";
import { toast, overlay, overlayOff } from "../UI/notify.js";
import { reloadIndicators } from "./indicators.js";
import { parseSymbols } from "../UI/format.js";

const $ = sel => document.querySelector(sel);

/** Recarga el listado de grupos (nombres y cantidad de miembros). */
export async function reloadGroups() {
  try {
    state.setGroups(await api.getGroups());
  } catch {
    /* se conserva el listado anterior */
  }
}

/** Reemplaza la vista por las acciones del grupo elegido. */
export async function viewGroup(groupId) {
  if (!groupId) return;

  try {
    const g = await api.getGroup(groupId);
    state.replaceSelection(g.members.map(m => m.symbol));
    await reloadIndicators();
    toast(`Viendo grupo "${g.groupName}" (${g.members.length} acciones)`, "info");
  } catch (err) {
    toast(err.message, "error");
  }
}

/**
 * Crea un grupo con los símbolos dados y lo deja visible. Las acciones
 * que no estaban cargadas se descargan en el momento (~1.5s cada una).
 * Éxito parcial: un símbolo mal tipeado no impide crear el grupo con
 * los demás.
 */
export async function createGroup(name, rawSymbols) {
  const clean = String(name ?? "").trim();
  if (!clean) {
    toast("El grupo necesita un nombre", "error");
    return;
  }

  const symbols = parseSymbols(rawSymbols);

  const btn = $("#create-group-btn");
  if (btn) btn.disabled = true;

  overlay(
    symbols.length
      ? `Creando grupo "${clean}"\nSincronizando ${symbols.length} acciones…`
      : `Creando grupo "${clean}"…`
  );

  try {
    const r = await api.createGroup(clean, symbols);

    const oks = r.results.filter(x => x.ok);
    const fails = r.results.filter(x => !x.ok);

    // Las nuevas traen nombre y bolsa: hay que releer el catálogo
    state.setCatalog(await api.getStocks());
    for (const x of oks) state.applyQuote(x.symbol, x.data.live);

    if (oks.length) {
      state.replaceSelection(oks.map(x => x.symbol));   // ver el grupo recién creado
    }

    await reloadIndicators();
    await reloadGroups();

    if (fails.length) {
      toast(
        `Grupo "${clean}" creado con ${oks.length} acciones.\nFallaron: ` +
        fails.map(x => `${x.symbol} (${x.error})`).join(", "),
        "error"
      );
    } else {
      toast(`Grupo "${clean}" creado (${oks.length} acciones)`, "ok");
    }

    $("#new-group-name").value = "";
    $("#new-group-symbols").value = "";

  } catch (err) {
    toast(err.message, "error");   // ej: 409 si el nombre ya existe
  } finally {
    overlayOff();
    if (btn) btn.disabled = false;
  }
}