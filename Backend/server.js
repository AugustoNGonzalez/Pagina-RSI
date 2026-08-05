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
  getRSIMatrix,
  getRSIByTimeframe,
  getRatioMatrix,
  clearAllData
} from "./Controllers/stocksController.js";

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

// cors: la app se usa también desde otra máquina de la red local (el
// navegador de otro equipo apuntando a este host).
app.use(cors());
app.use(express.json());  // parsea el body de los POST como JSON

// El frontend se sirve desde acá: mismo origen que la API, así el
// apiClient puede usar rutas relativas ("/api/..."). El path es absoluto
// para no depender del directorio desde donde se ejecute node.
app.use(express.static(path.join(__dirname, "../Frontend")));

// Acciones
app.get("/api/stocks", getAllStocks);
app.post("/api/stocks", addStock);
app.delete("/api/stocks/:id", deleteStock);
app.get("/api/rsi/matrix", getRSIMatrix);
app.post("/api/rsi/ratio-matrix", getRatioMatrix);
app.post("/api/rsi/by-timeframe", getRSIByTimeframe);

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