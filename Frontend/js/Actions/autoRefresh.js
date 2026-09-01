// Frontend/js/actions/autoRefresh.js
// Actualización automática de las acciones visibles mientras el mercado
// está abierto. Se dispara al cruzar cada hora en punto: es cuando
// cierra una vela horaria y los indicadores cambian de verdad, así que
// sincronizar en el medio traería precios nuevos pero los mismos
// indicadores.

import { AUTO_CHECK_MS } from "../config.js";
import * as state from "../state.js";
import { syncVisible, isSyncBusy } from "./stocks.js";

/**
 * Horario de la sesión regular de NYSE/NASDAQ (9:30–16:00 hora de Nueva
 * York), calculado en el huso del mercado para que el horario de verano
 * se ajuste solo.
 *
 * Dos límites conocidos: no contempla feriados (sincronizar uno es
 * inofensivo, Yahoo devuelve lo mismo), y asume que todo lo cargado
 * cotiza en Estados Unidos: para cripto (IBIT, ETHA) o mercados de otro
 * huso, la app deja de actualizarse aunque su mercado siga abierto.
 */
export function isMarketOpen() {
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

/** Hora actual, como número entero (para detectar el cruce). */
const currentHour = () => Math.floor(Date.now() / 3600000);

/**
 * Arranca el temporizador. Se llama una vez, al iniciar la app.
 * En vez de contar minutos desde el último sync, mira cuándo cambia la
 * hora: así la actualización cae siempre poco después de x:00.
 */
export function startAutoRefresh() {
  let lastHour = currentHour();

  setInterval(() => {
    const hour = currentHour();
    if (hour === lastHour) return;    // todavía no cruzamos la hora

    lastHour = hour;

    if (isSyncBusy()) return;
    if (!isMarketOpen()) return;
    if (!state.getSelected().length) return;

    syncVisible({ auto: true });
  }, AUTO_CHECK_MS);
}