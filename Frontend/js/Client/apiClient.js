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
 * segundos legítimos (descarga 5 años de Yahoo) y no hay que abortarlo.
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
  try { json = await res.json(); } catch { /* respuesta sin cuerpo JSON */ }

  if (!res.ok) {
    throw new Error(json?.error ?? `Error del servidor (${res.status})`);
  }

  return json;
}

// ============ Acciones ============

/**
 * Todas las acciones cargadas, con su última cotización conocida.
 * Fuente: la base (puede estar desactualizada hasta el próximo sync).
 * @returns {Promise<Array<{stockId, symbol, longName, exchange, lastPrice,
 *                          previousClose, lastEpoch, updatedAt}>>}
 */
export async function getStocks() {
  const rows = await request("GET", "/stocks");
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    stockId: r.StockId,
    symbol: r.Symbol,
    longName: r.LongName,
    exchange: r.Exchange,
    lastPrice: r.LastPrice,
    previousClose: r.PreviousClose,
    lastEpoch: r.LastEpoch,
    updatedAt: r.UpdatedAt
  }));
}

/**
 * Agrega una acción, o la re-sincroniza si ya existía (es el mismo
 * endpoint: también lo usa el botón Actualizar). Tarda unos segundos
 * si es nueva, porque baja 5 años de histórico.
 * La respuesta trae `live` con precio y RSI DEL MOMENTO: usarlos para
 * pintar directo, sin re-fetch.
 * @returns {Promise<{stockId, symbol, mode, inserted, rsiPersisted,
 *                    live: {price, previousClose, rsi, epoch}}>}
 */
export function addStock(symbol) {
  return request("POST", "/stocks", { symbol });
}

/** Borra una acción (y en cascada: sus precios, RSI y membresías de grupos). */
export function deleteStock(stockId) {
  return request("DELETE", `/stocks/${stockId}`);
}

/**
 * Último RSI persistido de cada acción (vela completada; el RSI vivo
 * intradía sólo viaja en las respuestas de addStock). Alimenta la
 * columna RSI de la tabla en la carga inicial.
 * @returns {Promise<Array<{symbol, rsi}>>}
 */
export async function getRSIMatrix() {
  const rows = await request("GET", "/rsi/matrix");
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({ symbol: r.Symbol, rsi: r.RSI }));
}

/**
 * Matriz N×N con el RSI de cada par A/B (RSI de la serie del ratio).
 * @param {Object<string, number>} live  precios del momento por símbolo,
 *        para que la matriz incluya la vela en curso como la tabla
 * @param {string[]} symbols  qué acciones calcular. Sin esto el backend
 *        haría los N² pares del catálogo entero.
 * @returns {Promise<{rows: Array<{symbol, cells}>}>}
 */
export async function getRatioMatrix(live = {}, symbols = [], timeframe = "1d") {
  const data = await request("POST", "/rsi/ratio-matrix", { live, symbols, timeframe });
  return data && Array.isArray(data.rows) ? data : { rows: [] };
}

/** Vacía la base: borra TODAS las acciones y grupos. Irreversible. */
export function clearAllData() {
  return request("DELETE", "/data");
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

/**
 * RSI de cada símbolo en el plazo pedido, calculado al vuelo.
 * @param {string[]} symbols
 * @param {"1h"|"1d"|"1wk"} timeframe
 * @param {Object<string, number>} live  precios del momento
 * @returns {Promise<Array<{symbol, rsi}>>}
 */
export async function getRSIByTimeframe(symbols, timeframe, live = {}) {
  const rows = await request("POST", "/rsi/by-timeframe", { symbols, timeframe, live });
  return Array.isArray(rows) ? rows : [];
}