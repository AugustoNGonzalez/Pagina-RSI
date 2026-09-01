// server.js
// Punto de entrada del backend: arma la app de Express, sirve el
// frontend estático y registra todas las rutas de la API.

// IMPORTANTE: dotenv tiene que ser el PRIMER import. Los imports de ES
// modules se evalúan antes que cualquier otra línea de este archivo, y
// connection.js (cargado transitivamente por los controllers) valida las
// env vars de la DB en el momento de importarse: si dotenv no corrió
// antes, el server muere al arrancar aunque el .env esté bien.
import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

import {
  getAllStocks,
  addStock,
  deleteStock,
  clearAllData
} from "./Controllers/stocksController.js";

import {
  getMeta,
  getIndicators,
  getRatioMatrix
} from "./Controllers/indicatorsController.js";

import {
  getAllGroups,
  getGroup,
  createGroup,
  renameGroup,
  deleteGroup,
  addStocksToGroup,
  removeStockFromGroup
} from "./Controllers/groupController.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3000;

// CORS: el frontend se sirve desde este mismo Express y usa rutas
// relativas ("/api/..."), así que las llamadas de la app son SIEMPRE
// same-origin, incluso desde otra máquina de la red: ese navegador
// también cargó la página de este host. CORS no hace falta para que
// funcione.
//
// Antes acá había `cors()` sin opciones, que acepta CUALQUIER origen.
// Como la API no tiene autenticación, cualquier página que el usuario
// abriera en otra pestaña podía mandarle un DELETE /api/data a este host
// y vaciar la base. Con `origin: false` no se emiten headers de CORS: el
// navegador rechaza el preflight y el pedido nunca llega.
//
// CORS_ORIGINS en el .env habilita orígenes puntuales (separados por
// coma) por si alguna vez se sirve el frontend aparte durante el
// desarrollo: CORS_ORIGINS=http://localhost:5500
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({ origin: corsOrigins.length ? corsOrigins : false }));
app.use(express.json());  // parsea el body de los POST como JSON

// El frontend se sirve desde acá: mismo origen que la API, así el
// apiClient puede usar rutas relativas ("/api/..."). El path es absoluto
// para no depender del directorio desde donde se ejecute node.
app.use(express.static(path.join(__dirname, "../Frontend")));

// Acciones
app.get("/api/stocks", getAllStocks);
app.post("/api/stocks", addStock);
app.delete("/api/stocks/:id", deleteStock);

// Indicadores (calculados al vuelo, nada persistido)
app.get("/api/indicators/meta", getMeta);
app.post("/api/indicators", getIndicators);
app.post("/api/indicators/ratio-matrix", getRatioMatrix);

// Vaciado total (panel de opciones)
app.delete("/api/data", clearAllData);

// Grupos
app.get("/api/groups", getAllGroups);
app.get("/api/groups/:id", getGroup);
app.post("/api/groups", createGroup);
app.patch("/api/groups/:id", renameGroup);
app.delete("/api/groups/:id", deleteGroup);
app.post("/api/groups/:id/stocks", addStocksToGroup);
app.delete("/api/groups/:id/stocks/:stockId", removeStockFromGroup);

app.listen(PORT, () => {
  console.log(`RSI server running on port ${PORT}`);
});