// Backend/smokeTest.js
// Batería de smoke tests contra la API. Requiere el server corriendo
// (node server.js en otra terminal). Ejecutar: node smokeTest.js
//
// NO DESTRUCTIVO: al arrancar toma nota de las acciones que ya existían
// y al terminar sólo borra las que creó él mismo. Las acciones y grupos
// preexistentes quedan intactos (a lo sumo re-sincronizados).

const BASE = "http://localhost:3000/api";

let passed = 0, failed = 0;
const preexisting = new Set();   // símbolos que ya estaban antes del test

function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
}

async function req(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const ms = Date.now() - t0;
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, ms };
}

// Valor de un indicador para un símbolo, dentro de la respuesta de /indicators
const valueOf = (rows, symbol, id = "rsi") =>
  (rows ?? []).find(r => r.symbol === symbol)?.values?.[id];

async function main() {
  console.log("== 1. GET /stocks (prueba la conexión a la base) ==");
  let r = await req("GET", "/stocks");
  check("responde 200", r.status === 200, `status=${r.status} ${JSON.stringify(r.json)}`);
  check("devuelve un array", Array.isArray(r.json));

  // Foto del catálogo: nada de esto se borra al final
  if (Array.isArray(r.json)) {
    for (const s of r.json) preexisting.add(s.Symbol);
    console.log(`  (preexistentes, se conservan: ${preexisting.size ? [...preexisting].join(", ") : "ninguna"})`);
  }

  console.log("== 2. GET /indicators/meta (catálogo de indicadores) ==");
  r = await req("GET", "/indicators/meta");
  check("responde 200", r.status === 200);
  const meta = r.json ?? [];
  check("devuelve al menos un indicador", meta.length > 0);
  const rsiMeta = meta.find(m => m.id === "rsi");
  check("incluye rsi", !!rsiMeta);
  check("rsi declara escala bounded 0-100 neutro 50",
    rsiMeta?.scale === "bounded" && rsiMeta?.min === 0 && rsiMeta?.max === 100 && rsiMeta?.neutral === 50,
    JSON.stringify(rsiMeta));

  console.log("== 3. POST /stocks AAPL diario (sync completo, tarda unos segundos) ==");
  r = await req("POST", "/stocks", { symbol: "AAPL", interval: "1d" });
  check("responde 200", r.status === 200, JSON.stringify(r.json));
  const first = r.json ?? {};
  check("trae stockId", Number.isInteger(first.stockId));
  check("interval = 1d", first.interval === "1d");
  check("live.price es número", typeof first.live?.price === "number");
  check("NO devuelve indicadores (se piden aparte)", first.live?.rsi === undefined);
  if (first.mode === "initial") {
    check("inserted > 1000 (5 años de velas)", first.inserted > 1000, `inserted=${first.inserted}`);
  } else {
    console.log("  (AAPL ya estaba cargado: corrida repetida, se saltan los chequeos de carga inicial)");
  }

  console.log("== 4. POST /stocks AAPL de nuevo (idempotencia) ==");
  r = await req("POST", "/stocks", { symbol: "AAPL", interval: "1d" });
  check("responde 200", r.status === 200);
  check("mode = update", r.json?.mode === "update", `mode=${r.json?.mode}`);
  check("inserted = 0", r.json?.inserted === 0,
    `inserted=${r.json?.inserted} -> si es >0, falla el filtro de epochs o el split de la vela en curso`);

  console.log("== 5. POST /stocks AAPL horario (velas de 1h) ==");
  r = await req("POST", "/stocks", { symbol: "AAPL", interval: "1h" });
  check("responde 200", r.status === 200, JSON.stringify(r.json));
  check("interval = 1h", r.json?.interval === "1h");
  if (r.json?.mode === "initial") {
    check("inserted > 100 (HOURLY_HISTORY_DAYS de velas horarias, 250 por defecto)",
      r.json.inserted > 100, `inserted=${r.json?.inserted}`);
  }

  console.log("== 6. GET /stocks (AAPL con cotización) ==");
  r = await req("GET", "/stocks");
  const aapl = (r.json ?? []).find(s => s.Symbol === "AAPL");
  check("AAPL en el listado", !!aapl);
  check("LastPrice poblado", aapl?.LastPrice != null);
  check("PreviousClose poblado", aapl?.PreviousClose != null);
  check("UpdatedAt poblado", aapl?.UpdatedAt != null);

  console.log("== 7. POST /stocks con ticker inexistente ==");
  r = await req("POST", "/stocks", { symbol: "ZZZZFAKE99" });
  check("responde 404", r.status === 404, `status=${r.status} body=${JSON.stringify(r.json)}`);
  check("responde rápido (<5s, sin reintentos)", r.ms < 5000,
    `tardó ${r.ms}ms -> calibrar isNonRetryable/isSymbolNotFound (mirar consola del server)`);

  console.log("== 8. POST /indicators en los tres plazos ==");
  const daily = await req("POST", "/indicators", { symbols: ["AAPL"], timeframe: "1d" });
  check("diario responde 200", daily.status === 200);
  const rsiD = valueOf(daily.json, "AAPL");
  check("RSI diario entre 0 y 100", typeof rsiD === "number" && rsiD >= 0 && rsiD <= 100, `rsi=${rsiD}`);

  const weekly = await req("POST", "/indicators", { symbols: ["AAPL"], timeframe: "1wk" });
  const rsiW = valueOf(weekly.json, "AAPL");
  check("RSI semanal entre 0 y 100", typeof rsiW === "number" && rsiW >= 0 && rsiW <= 100, `rsi=${rsiW}`);
  check("semanal ≠ diario", rsiW !== rsiD, `1d=${rsiD} 1wk=${rsiW}`);

  const hourly = await req("POST", "/indicators", { symbols: ["AAPL"], timeframe: "1h" });
  const rsiH = valueOf(hourly.json, "AAPL");
  check("RSI horario entre 0 y 100", typeof rsiH === "number" && rsiH >= 0 && rsiH <= 100, `rsi=${rsiH}`);
  check("horario ≠ diario", rsiH !== rsiD, `1d=${rsiD} 1h=${rsiH}`);
  console.log(`  >> ANOTAR: AAPL 1D=${rsiD}  1S=${rsiW}  1H=${rsiH}  (comparar con TradingView)`);

  console.log("== 9. POST /indicators con precio vivo ==");
  const fakePrice = (aapl?.LastPrice ?? 300) * 1.15;   // +15%: tiene que mover el RSI
  r = await req("POST", "/indicators", {
    symbols: ["AAPL"], timeframe: "1d", live: { AAPL: fakePrice }
  });
  const rsiLive = valueOf(r.json, "AAPL");
  check("el precio vivo cambia el RSI", typeof rsiLive === "number" && rsiLive !== rsiD,
    `sin live=${rsiD} con live=${rsiLive} -> si son iguales, el período en curso no se está cerrando`);

  console.log("== 10. POST /groups con símbolos (tarda ~15s: dos intervalos por acción) ==");
  r = await req("POST", "/groups", { name: "SmokeTest", symbols: ["MSFT", "NVDA"] });
  check("responde 200", r.status === 200, JSON.stringify(r.json));
  const groupId = r.json?.groupId;
  check("trae groupId", Number.isInteger(groupId));
  check("ambos símbolos ok", (r.json?.results ?? []).every(x => x.ok),
    JSON.stringify((r.json?.results ?? []).filter(x => !x.ok)));

  // El alta por grupo baja los dos intervalos: si sólo bajara el diario,
  // al pasar a 1H estas acciones aparecerían vacías.
  r = await req("POST", "/indicators", { symbols: ["MSFT"], timeframe: "1h" });
  check("las del grupo tienen velas horarias", typeof valueOf(r.json, "MSFT") === "number",
    "el alta por grupo debería bajar 1d y 1h");

  console.log("== 11. POST /indicators/ratio-matrix ==");
  r = await req("POST", "/indicators/ratio-matrix", {
    symbols: ["AAPL", "MSFT", "NVDA"], timeframe: "1d", indicator: "rsi"
  });
  check("responde 200", r.status === 200);
  const rows = r.json?.rows ?? [];
  check("devuelve 3 filas", rows.length === 3, `rows=${rows.length}`);

  const cellOf = (rowSym, colSym) =>
    rows.find(x => x.symbol === rowSym)?.cells?.find(c => c.symbol === colSym);

  const ab = cellOf("AAPL", "MSFT");
  const ba = cellOf("MSFT", "AAPL");
  check("celda AAPL/MSFT con valor 0-100",
    typeof ab?.value === "number" && ab.value >= 0 && ab.value <= 100, `value=${ab?.value}`);
  check("usa cientos de velas en común", ab?.points > 100, `points=${ab?.points}`);
  check("la diagonal es null", cellOf("AAPL", "AAPL")?.value === null);
  // El punto del diseño: el valor de B/A NO es 100 - el de A/B. Si diera
  // el complemento exacto, se estaría espejando en vez de calcular.
  check("A/B y B/A no son complementarios",
    typeof ba?.value === "number" && Math.abs((100 - ab.value) - ba.value) > 0.5,
    `AAPL/MSFT=${ab?.value} MSFT/AAPL=${ba?.value}`);
  console.log(`  >> ANOTAR: AAPL/MSFT=${ab?.value}  (comparar en TradingView con el símbolo "AAPL/MSFT")`);

  r = await req("POST", "/indicators/ratio-matrix", { symbols: ["AAPL"], timeframe: "1d" });
  check("con menos de 2 símbolos devuelve vacío", (r.json?.rows ?? []).length === 0);

  console.log("== 12. POST /groups con nombre duplicado ==");
  r = await req("POST", "/groups", { name: "SmokeTest" });
  check("responde 409", r.status === 409, `status=${r.status}`);

  console.log("== 13. GET /groups, /groups/:id y PATCH (renombrar) ==");
  r = await req("GET", "/groups");
  const g = (r.json ?? []).find(x => x.GroupName === "SmokeTest");
  check("grupo listado con MemberCount=2", g?.MemberCount === 2, `MemberCount=${g?.MemberCount}`);
  r = await req("GET", `/groups/${groupId}`);
  check("detalle con 2 miembros", (r.json?.members ?? []).length === 2);
  r = await req("PATCH", `/groups/${groupId}`, { name: "SmokeTestRenombrado" });
  check("renombrar responde 200", r.status === 200, `status=${r.status}`);
  check("devuelve el nombre nuevo", r.json?.groupName === "SmokeTestRenombrado");

  console.log("== 14. Editar miembros del grupo ==");
  r = await req("POST", `/groups/${groupId}/stocks`, { symbols: ["AAPL"] });
  check("sumar AAPL responde 200", r.status === 200, JSON.stringify(r.json));
  r = await req("GET", `/groups/${groupId}`);
  const members = r.json?.members ?? [];
  check("ahora son 3 miembros", members.length === 3, `members=${members.length}`);

  const aaplId = members.find(m => m.symbol === "AAPL")?.stockId;
  r = await req("DELETE", `/groups/${groupId}/stocks/${aaplId}`);
  check("quitar AAPL responde 200", r.status === 200 && r.json?.removed === true);
  r = await req("DELETE", `/groups/${groupId}/stocks/${aaplId}`);
  check("re-quitar da 404", r.status === 404, `status=${r.status}`);
  r = await req("GET", `/groups/${groupId}`);
  check("vuelve a 2 miembros", (r.json?.members ?? []).length === 2);
  check("AAPL sigue en el catálogo (sólo salió del grupo)",
    (await req("GET", "/stocks")).json?.some(s => s.Symbol === "AAPL") === true);

  console.log("== 15. Limpieza: borra SÓLO lo que creó este test ==");
  r = await req("DELETE", `/groups/${groupId}`);
  check("grupo borrado", r.status === 200 && r.json?.deleted === true);
  r = await req("DELETE", `/groups/${groupId}`);
  check("re-borrar el grupo da 404", r.status === 404, `status=${r.status}`);

  r = await req("GET", "/stocks");
  const created = (r.json ?? []).filter(s => !preexisting.has(s.Symbol));
  if (!created.length) {
    console.log("  (el test no creó acciones nuevas: nada que borrar)");
  }
  for (const s of created) {
    const d = await req("DELETE", `/stocks/${s.StockId}`);
    check(`DELETE ${s.Symbol} (creada por el test)`, d.status === 200 && d.json?.deleted === true);
  }

  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed === 0) {
    console.log("API OK. Siguen: chequeo de duplicados en SSMS, comparación con TradingView, test intradía en horario de mercado.");
  }

  // Código de salida, para poder encadenarlo (`node smokeTest.js && ...`)
  // o correrlo desde un .bat sin tener que leer la salida.
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(err => {
  console.error("\nEl script no pudo completarse:", err.message);
  console.error("¿Está corriendo el server? (node server.js en otra terminal)");
  process.exitCode = 1;
});