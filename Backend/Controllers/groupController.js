// Controllers/groupController.js
// Endpoints de grupos: conjuntos de acciones que el usuario define para
// cargarlas juntas en la vista (ej: "Semiconductores"). Se manejan por
// SÍMBOLOS, no por ids: las acciones que todavía no estaban cargadas se
// descargan en el momento.

import { getConnection, sql } from "../Database/connection.js";
import * as q from "../Database/queries.js";
import { syncMany } from "../Services/syncService.js";
import { normalizeSymbols } from "../Services/stockService.js";

const clip = (v, max) => (v == null ? null : String(v).slice(0, max));

/**
 * Sincroniza símbolos (alta incluida si son nuevos) y los asocia a un
 * grupo. En serie y tolerante a fallos: un símbolo mal tipeado no impide
 * agregar los demás. Lo comparten createGroup y addStocksToGroup.
 * @returns los results de syncMany, con ok:false en los que fallaron
 */
async function syncAndLink(pool, groupId, symbols) {
  const results = await syncMany(symbols);

  for (const r of results) {
    if (!r.ok) continue;

    try {
      await pool.request()
        .input("GroupId", sql.Int, groupId)
        .input("StockId", sql.Int, r.data.stockId)
        .query(q.ADD_STOCK_TO_GROUP);
    } catch (err) {
      // 2627 = ya era miembro del grupo. No es un error: el objetivo
      // (que la acción esté en el grupo) ya se cumple.
      if (err.number !== 2627) {
        r.ok = false;
        r.error = "Sincronizada pero no se pudo asociar al grupo";
      }
    }
  }

  return results;
}

// GET /api/groups — listado de todos los grupos (para el selector del frontend)
export async function getAllGroups(req, res) {
  try {
    const pool = await getConnection();
    const result = await pool.request().query(q.SELECT_ALL_GROUPS);
    res.json(result.recordset ?? []);   // sin grupos, recordset puede venir undefined

  } catch (err) {
    console.error("[getAllGroups]", err);
    res.status(500).json({ error: "Error obteniendo grupos" });
  }
}

// GET /api/groups/:id — un grupo con todas sus acciones miembro
export async function getGroup(req, res) {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ error: "GroupId inválido" });
  }

  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("GroupId", sql.Int, groupId)
      .query(q.SELECT_GROUP_WITH_MEMBERS);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Grupo no encontrado" });
    }

    // Las filas vienen "planas" (datos del grupo repetidos por miembro):
    // se arma un objeto único con su array de miembros. Un grupo vacío
    // trae una fila con StockId null (por el LEFT JOIN del query).
    const rows = result.recordset;
    res.json({
      groupId: rows[0].GroupId,
      groupName: rows[0].GroupName,
      members: rows
        .filter(r => r.StockId != null)
        .map(r => ({ stockId: r.StockId, symbol: r.Symbol }))
    });

  } catch (err) {
    console.error("[getGroup]", err);
    res.status(500).json({ error: "Error obteniendo grupo" });
  }
}

// POST /api/groups { name, description?, symbols? } — crea un grupo y,
// si vienen símbolos, los sincroniza y asocia. Devuelve el resultado por
// símbolo para que el frontend pueda avisar cuáles fallaron.
export async function createGroup(req, res) {
  const { name, description, symbols } = req.body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Nombre requerido" });
  }

  try {
    const pool = await getConnection();

    // 1) Crear el grupo (falla rápido si el nombre ya existe)
    let groupId;
    try {
      const insertRes = await pool.request()
        .input("GroupName", sql.NVarChar(100), clip(name.trim(), 100))
        .input("Description", sql.NVarChar(255), clip(description, 255))
        .query(q.INSERT_GROUP);

      groupId = insertRes.recordset[0].GroupId;
    } catch (err) {
      if (err.number === 2627) {
        return res.status(409).json({ error: `Ya existe un grupo llamado "${name.trim()}"` });
      }
      throw err;
    }

    // 2) Sumarle los símbolos, si vinieron. Sin transacción a propósito:
    // el sync hace requests HTTP de varios segundos y no hay que tener
    // la conexión tomada mientras tanto. Si se corta, queda un grupo
    // incompleto: estado válido y reparable, no corrupción.
    const list = normalizeSymbols(symbols);
    const results = list.length ? await syncAndLink(pool, groupId, list) : [];

    res.json({ groupId, results });

  } catch (err) {
    console.error("[createGroup]", err);
    res.status(500).json({ error: "Error creando grupo" });
  }
}

// PATCH /api/groups/:id { name } — renombra un grupo existente.
export async function renameGroup(req, res) {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ error: "GroupId inválido" });
  }

  const { name } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Nombre requerido" });
  }

  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("GroupId", sql.Int, groupId)
      .input("GroupName", sql.NVarChar(100), clip(name.trim(), 100))
      .query(q.UPDATE_GROUP_NAME);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Grupo no encontrado" });
    }

    res.json({ groupId, groupName: name.trim() });

  } catch (err) {
    if (err.number === 2627) {
      return res.status(409).json({ error: `Ya existe un grupo llamado "${name.trim()}"` });
    }
    console.error("[renameGroup]", err);
    res.status(500).json({ error: "Error renombrando grupo" });
  }
}

// DELETE /api/groups/:id — borra un grupo (sus membresías caen por
// CASCADE; las acciones NO se borran, pueden estar en otros grupos)
export async function deleteGroup(req, res) {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ error: "GroupId inválido" });
  }

  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("GroupId", sql.Int, groupId)
      .query(q.DELETE_GROUP);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Grupo no encontrado" });
    }

    res.json({ deleted: true });

  } catch (err) {
    console.error("[deleteGroup]", err);
    res.status(500).json({ error: "Error eliminando grupo" });
  }
}

// POST /api/groups/:id/stocks { symbols } — suma acciones a un grupo
// existente. Éxito parcial: un símbolo mal tipeado no impide agregar
// los demás.
export async function addStocksToGroup(req, res) {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ error: "GroupId inválido" });
  }

  const list = normalizeSymbols(req.body?.symbols);
  if (!list.length) {
    return res.status(400).json({ error: "Se requiere al menos un símbolo" });
  }

  try {
    const pool = await getConnection();

    // Se verifica que el grupo exista antes de tocar sus miembros: sin
    // esto el INSERT fallaría por FK con un error genérico, no un 404.
    const grp = await pool.request()
      .input("GroupId", sql.Int, groupId)
      .query(q.SELECT_GROUP_BY_ID);

    if (!grp.recordset.length) {
      return res.status(404).json({ error: "Grupo no encontrado" });
    }

    const results = await syncAndLink(pool, groupId, list);
    res.json({ groupId, results });

  } catch (err) {
    console.error("[addStocksToGroup]", err);
    res.status(500).json({ error: "Error agregando acciones al grupo" });
  }
}

// DELETE /api/groups/:id/stocks/:stockId — saca una acción de un grupo.
// La acción sigue cargada en el sistema y en sus otros grupos.
export async function removeStockFromGroup(req, res) {
  const groupId = Number(req.params.id);
  const stockId = Number(req.params.stockId);

  if (!Number.isInteger(groupId) || groupId <= 0 ||
      !Number.isInteger(stockId) || stockId <= 0) {
    return res.status(400).json({ error: "Id inválido" });
  }

  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("GroupId", sql.Int, groupId)
      .input("StockId", sql.Int, stockId)
      .query(q.REMOVE_STOCK_FROM_GROUP);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Esa acción no está en el grupo" });
    }

    res.json({ removed: true });

  } catch (err) {
    console.error("[removeStockFromGroup]", err);
    res.status(500).json({ error: "Error quitando la acción del grupo" });
  }
}