// Frontend/js/Client/apiClient.js
// Única capa del frontend que habla con el backend. Nadie más usa fetch
// ni conoce URLs. Todas las funciones devuelven promesas: resuelven con
// los datos ya normalizados a camelCase, o rechazan con un Error cuyo
// .message se puede mostrar tal cual al usuario (los mensajes de error
// del backend ya vienen en español).

const API = "/api"; // rutas relativas: el backend sirve este frontend (mismo origen)

/**
 * Helper central: arma el request, parsea el JSON y convierte los status
 * de error (4xx/5xx) en excepciones con el mensaje del backend.
 * Sin timeout a propósito: agregar una acción nueva puede tardar varios
 * segundos legítimos (descarga años de histórico) y no hay que abortarlo.
 */
async function request(method, path, body) {
  let res;

  try {
    res = await fetch(API + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    // fetch sólo rechaza por problemas de red: server caído, sin conexión
    throw new Error("No se pudo conectar con el servidor. ¿Está corriendo?");
  }

  let json = null;
  try { json = await res.json(); }
  catch { console.warn(`[apiClient] respuesta no-JSON en ${method} ${path} (status ${res.status})`); }

  if (!res.ok) {
    throw new Error(json?.error ?? `Error del servidor (${res.status})`);
  }

  return json;
}

// ============ Acciones ============

/**
 * Todas las acciones cargadas, con su última cotización conocida.
 * Fuente: la base (puede estar desactualizada hasta el próximo sync).
 * Los indicadores NO vienen acá: se piden por getIndicators().
 * @returns {Promise<Array<{stockId, symbol, longName, shortName, exchange,
 *                          lastPrice, previousClose, lastEpoch, updatedAt}>>}
 */
export async function getStocks() {
  const rows = await request("GET", "/stocks");
  if (!Array.isArray(rows)) return [];

  // Los DECIMAL y BIGINT de SQL Server pueden llegar como string según la
  // versión del driver. Toda la app los trata como número: getLivePrices
  // filtra por `typeof === "number"` y la variación diaria hace
  // aritmética, así que si vinieran como texto los precios y el RSI vivo
  // desaparecerían de la tabla en silencio, sin ningún error visible.
  // priceService ya hacía esta conversión del lado del backend.
  const num = v => (v == null ? null : Number(v));

  return rows.map(r => ({
    stockId: r.StockId,
    symbol: r.Symbol,
    longName: r.LongName,
    shortName: r.ShortName,
    exchange: r.Exchange,
    lastPrice: num(r.LastPrice),
    previousClose: num(r.PreviousClose),
    lastEpoch: num(r.LastEpoch),
    updatedAt: r.UpdatedAt
  }));
}

/**
 * Agrega una acción, o la re-sincroniza si ya existía (es el mismo
 * endpoint: también lo usa el botón Actualizar). Tarda unos segundos si
 * es nueva, porque baja el histórico completo.
 *
 * @param {string} symbol
 * @param {"1d"|"1h"} interval  qué granularidad sincronizar. El horario
 *        se pide sólo cuando el usuario está en ese plazo: bajarlo
 *        siempre duplicaría el tiempo de cada actualización.
 * @returns {Promise<{stockId, symbol, interval, mode, inserted,
 *                    live: {price, previousClose, epoch}}>}
 */
export function addStock(symbol, interval = "1d") {
  return request("POST", "/stocks", { symbol, interval });
}

/** Borra una acción (y en cascada: sus velas y membresías de grupos). */
export function deleteStock(stockId) {
  return request("DELETE", `/stocks/${stockId}`);
}

/** Vacía la base: borra TODAS las acciones y grupos. Irreversible. */
export function clearAllData() {
  return request("DELETE", "/data");
}

// ============ Indicadores ============

/**
 * Catálogo de indicadores disponibles: qué existe, cómo se llama y en
 * qué escala se mueve. El frontend arma columnas y colores con esto, sin
 * conocer los indicadores de antemano.
 * @returns {Promise<Array<{id, label, scale, min?, max?, neutral?}>>}
 */
export async function getIndicatorMeta() {
  const rows = await request("GET", "/indicators/meta");
  return Array.isArray(rows) ? rows : [];
}

/**
 * Valores de los indicadores pedidos para cada símbolo, en el plazo
 * pedido. Se calculan al vuelo en el backend, no hay nada persistido.
 *
 * @param {string[]} symbols
 * @param {"1h"|"1d"|"1wk"} timeframe
 * @param {string[]} indicators  ids; vacío = todos
 * @param {Object<string, number>} live  precios del momento, para cerrar
 *        el período en curso (la base sólo tiene velas cerradas)
 * @returns {Promise<Array<{symbol, values: Object<string, number|null>}>>}
 */
export async function getIndicators(symbols, timeframe, indicators, live = {}) {
  const rows = await request("POST", "/indicators", { symbols, timeframe, indicators, live });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Matriz N×N con el indicador aplicado a cada par A/B.
 *
 * @param {string[]} symbols  obligatorio: con N símbolos son N² pares,
 *        así que pedir el catálogo entero sería un segundo de cómputo
 *        bloqueante en el backend
 * @param {"1h"|"1d"|"1wk"} timeframe
 * @param {string} indicator
 * @param {Object<string, number>} live
 * @returns {Promise<{rows: Array<{symbol, cells: Array<{symbol, value, points}>}>}>}
 */
export async function getRatioMatrix(symbols, timeframe, indicator, live = {}) {
  const data = await request("POST", "/indicators/ratio-matrix", {
    symbols, timeframe, indicator, live
  });
  return data && Array.isArray(data.rows) ? data : { rows: [] };
}

// ============ Grupos ============

/**
 * Listado de grupos para el selector del aside.
 * @returns {Promise<Array<{groupId, groupName, description, memberCount}>>}
 */
export async function getGroups() {
  const rows = await request("GET", "/groups");
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    groupId: r.GroupId,
    groupName: r.GroupName,
    description: r.Description,
    memberCount: r.MemberCount
  }));
}

/**
 * Un grupo con sus miembros. (El backend ya lo devuelve en camelCase.)
 * @returns {Promise<{groupId, groupName, members: Array<{stockId, symbol}>}>}
 */
export function getGroup(groupId) {
  return request("GET", `/groups/${groupId}`);
}

/**
 * Crea un grupo y sincroniza sus símbolos (los nuevos se dan de alta).
 * Tarda ~1.5s por símbolo. Puede tener éxito PARCIAL: revisar `results`
 * y avisar por los que vengan con ok:false ("NVDIA no existe").
 * @returns {Promise<{groupId, results: Array<{symbol, ok, data?, error?}>}>}
 */
export function createGroup(name, symbols, description = null) {
  return request("POST", "/groups", { name, symbols, description });
}

/** Renombra un grupo. Rechaza con 409 si el nombre ya existe. */
export function renameGroup(groupId, name) {
  return request("PATCH", `/groups/${groupId}`, { name });
}

/** Borra un grupo. Las acciones NO se borran, sólo la agrupación. */
export function deleteGroup(groupId) {
  return request("DELETE", `/groups/${groupId}`);
}

/**
 * Suma acciones a un grupo existente, por símbolo. Las que no estén
 * cargadas se descargan (tarda ~1.5s por símbolo nuevo). Puede tener
 * éxito parcial: revisar `results`.
 * @returns {Promise<{groupId, results: Array<{symbol, ok, data?, error?}>}>}
 */
export function addStocksToGroup(groupId, symbols) {
  return request("POST", `/groups/${groupId}/stocks`, { symbols });
}

/** Saca una acción de un grupo. La acción sigue cargada en el sistema. */
export function removeStockFromGroup(groupId, stockId) {
  return request("DELETE", `/groups/${groupId}/stocks/${stockId}`);
}