// Frontend/js/state.js  (esquema)
let catalog = [];
const selected = new Set();
let ratioMatrix = { symbols: [], rows: [] };
const listeners = [];

export const getCatalog = () => catalog;
export const getVisible = () => catalog.filter(s => selected.has(s.symbol));
export function setCatalog(next) { catalog = next; notify(); }
export function subscribe(fn) { listeners.push(fn); }
function notify() { listeners.forEach(fn => fn()); }