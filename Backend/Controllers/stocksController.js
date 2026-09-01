// Controllers/stocksController.js
// CRUD de acciones: listar, agregar/sincronizar, borrar, y el vaciado
// total de la base. Los cálculos viven en indicatorsController.

import { getConnection, sql } from "../Database/connection.js";
import * as q from "../Database/queries.js";
import { syncStock } from "../Services/syncService.js";
// Distingue "el símbolo no existe" (culpa del input del usuario → 404) de
// un error real del servidor/Yahoo (→ 500). Vive en marketDataService,
// que es quien conoce la forma de los errores de Yahoo.
import { isSymbolNotFound } from "../Services/marketDataService.js";

// GET /api/stocks — todas las acciones cargadas, con su último precio
export async function getAllStocks(req, res) {
  try {
    const pool = await getConnection();
    const result = await pool.request().query(q.SELECT_ALL_STOCKS);

    res.json(result.recordset ?? []);

  } catch (err) {
    console.error("[getAllStocks]", err);
    res.status(500).json({ error: "Error obteniendo stocks" });
  }
}

/**
 * POST /api/stocks { symbol, interval? } — da de alta una acción, o la
 * actualiza si ya existe (es el mismo flujo). `interval` decide qué
 * granularidad sincronizar: '1d' por defecto, '1h' cuando el frontend
 * pasa al plazo horario y esa acción todavía no tiene velas de una hora.
 *
 * La respuesta trae `live` con la cotización del momento. Los
 * indicadores NO vienen acá: se piden por /api/indicators.
 */
export async function addStock(req, res) {
  const { symbol, interval } = req.body ?? {};

  if (!symbol || typeof symbol !== "string" || !symbol.trim()) {
    return res.status(400).json({ error: "Symbol requerido" });
  }

  const clean = symbol.trim().toUpperCase();
  const iv = interval === "1h" ? "1h" : "1d";

  try {
    res.json(await syncStock(clean, iv));

  } catch (err) {
    if (isSymbolNotFound(err)) {
      return res.status(404).json({ error: `Símbolo no encontrado: ${clean}` });
    }

    console.error("[addStock]", err);
    res.status(500).json({ error: "Error sincronizando stock" });
  }
}

// DELETE /api/stocks/:id — borra una acción. Las FKs con ON DELETE
// CASCADE limpian automáticamente (y de forma atómica) sus velas, última
// cotización y membresías de grupo: es un solo statement, no hace falta
// transacción ni limpieza manual.
export async function deleteStock(req, res) {
  const stockId = Number(req.params.id);
  if (!Number.isInteger(stockId) || stockId <= 0) {
    return res.status(400).json({ error: "StockId inválido" });
  }

  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("StockId", sql.Int, stockId)
      .query(q.DELETE_STOCK);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Stock no encontrado" });
    }

    res.json({ deleted: true });

  } catch (err) {
    console.error("[deleteStock]", err);
    res.status(500).json({ error: "Error eliminando stock" });
  }
}

// DELETE /api/data — vacía la base: todas las acciones y todos los
// grupos, con su historial (las FKs en cascada hacen el resto).
// En transacción: o se borra todo, o no se borra nada.
// La confirmación con el usuario es responsabilidad del frontend.
export async function clearAllData(req, res) {
  let tx;
  try {
    const pool = await getConnection();
    tx = new sql.Transaction(pool);

    await tx.begin();
    await tx.request().query(q.DELETE_ALL_GROUPS);
    await tx.request().query(q.DELETE_ALL_STOCKS);
    await tx.commit();

    res.json({ cleared: true });

  } catch (err) {
    console.error("[clearAllData]", err);
    if (tx) {
      try { await tx.rollback(); } catch (e) { console.error("[clearAllData][rollback]", e); }
    }
    res.status(500).json({ error: "Error vaciando la base de datos" });
  }
}