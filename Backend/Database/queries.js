// Database/queries.js
// Todas las queries parametrizadas (@Param) que usan los Services y
// Controllers. Ninguna concatena strings directamente, por eso no hay
// riesgo de SQL injection en ningún punto de la app.

// ============================================================
// Acciones (tabla Stocks)
// ============================================================

// Busca el StockId de una acción ya cargada, por su símbolo (ticker).
export const SELECT_STOCK_BY_SYMBOL = `
SELECT StockId
FROM Stocks
WHERE Symbol = @Symbol;
`;

// Inserta una acción nueva a partir de los metadatos que devuelve Yahoo
// Finance, y devuelve el StockId recién generado.
export const INSERT_STOCK = `
INSERT INTO Stocks (Symbol, LongName, ShortName, Exchange, Currency, InstrumentType)
VALUES (@Symbol, @LongName, @ShortName, @Exchange, @Currency, @InstrumentType);

SELECT CAST(SCOPE_IDENTITY() AS INT) AS StockId;
`;

// Listado de todas las acciones cargadas con su última cotización
// conocida. LEFT JOIN porque una acción recién agregada podría no tener
// todavía fila en StockLastQuote. Alimenta la tabla del frontend.
export const SELECT_ALL_STOCKS = `
SELECT s.StockId, s.Symbol, s.LongName, s.Exchange,
       l.LastPrice, l.LastEpoch, l.PreviousClose, l.UpdatedAt
FROM Stocks s
LEFT JOIN StockLastQuote l ON l.StockId = s.StockId
ORDER BY s.Symbol;
`;

// Borra una acción. Las FKs con ON DELETE CASCADE limpian automáticamente
// sus precios, RSI, última cotización y membresías de grupo.
export const DELETE_STOCK = `
DELETE FROM Stocks
WHERE StockId = @StockId;
`;

// ============================================================
// Precios y cotización
// ============================================================

// Epoch (timestamp Unix) de la vela COMPLETADA más reciente ya guardada
// para una acción. Sirve para saber desde dónde persistir velas nuevas.
// (La vela en curso del día nunca se guarda, vive solo en memoria.)
export const GET_LAST_EPOCH = `
SELECT MAX(Epoch) AS LastEpoch
FROM StockPrices
WHERE StockId = @StockId;
`;

// Todo el histórico de cierres de una acción, ordenado de más viejo a
// más nuevo. Insumo del cálculo de RSI: se recalcula siempre la serie
// completa (Wilder es recursivo, no admite cálculo por ventana parcial)
// y se persisten solo los valores nuevos.
export const SELECT_PRICES_FOR_RSI = `
SELECT Epoch, ClosePrice
FROM StockPrices
WHERE StockId = @StockId
ORDER BY Epoch ASC;
`;

// Cierres de un subconjunto de acciones, ordenados por acción y fecha.
// Insumo de la matriz de ratios. El filtro va en SQL y no en JS porque
// traer el catálogo entero para usar 3 símbolos transfiere decenas de
// miles de filas al pedo. @Symbols llega como CSV ("AAPL,MSFT") y se
// parte con STRING_SPLIT: es parametrizado, no concatenación.
export const SELECT_CLOSES_FOR_SYMBOLS = `
SELECT s.Symbol, p.Epoch, p.ClosePrice
FROM Stocks s
JOIN StockPrices p ON p.StockId = s.StockId
WHERE p.ClosePrice IS NOT NULL
  AND s.Symbol IN (SELECT value FROM STRING_SPLIT(@Symbols, ','))
ORDER BY s.Symbol, p.Epoch ASC;
`;

// Actualiza la última cotización de una acción, o la inserta si todavía
// no existía (upsert manual: UPDATE primero, y si @@ROWCOUNT queda en 0,
// INSERT). Es la única tabla que se pisa en cada sync: acá va el precio
// VIVO intradía (regularMarketPrice de Yahoo), no el último cierre.
export const UPSERT_LAST_QUOTE = `
UPDATE StockLastQuote
SET LastPrice = @LastPrice,
    PreviousClose = @PreviousClose,
    LastEpoch = @LastEpoch,
    UpdatedAt = SYSUTCDATETIME()
WHERE StockId = @StockId;

IF @@ROWCOUNT = 0
BEGIN
    INSERT INTO StockLastQuote (StockId, LastPrice, PreviousClose, LastEpoch, UpdatedAt)
    VALUES (@StockId, @LastPrice, @PreviousClose, @LastEpoch, SYSUTCDATETIME());
END
`;

// ============================================================
// RSI
// ============================================================

// Epoch del último RSI ya calculado y guardado para una acción+período.
// Marca desde dónde PERSISTIR (no desde dónde calcular: el cálculo
// siempre corre sobre el histórico completo).
export const GET_LAST_RSI_EPOCH = `
SELECT MAX(Epoch) AS LastRSIEpoch
FROM StockRSI
WHERE StockId = @StockId AND RSIPeriod = @RSIPeriod;
`;

// Último RSI persistido de TODAS las acciones para un período dado
// (subquery correlacionada: por cada acción, la fila con el Epoch más
// alto). Alimenta la columna RSI de la tabla en la carga inicial; el
// RSI vivo intradía viaja en la respuesta de cada sync, no sale de acá.
export const SELECT_LAST_RSI_FOR_SYMBOLS = `
SELECT s.Symbol, r.RSI
FROM Stocks s
JOIN StockRSI r ON r.StockId = s.StockId
WHERE r.RSIPeriod = @RSIPeriod
AND r.Epoch = (
    SELECT MAX(r2.Epoch)
    FROM StockRSI r2
    WHERE r2.StockId = s.StockId
      AND r2.RSIPeriod = @RSIPeriod
);
`;

// ============================================================
// Grupos
// ============================================================

// Listado de todos los grupos con su cantidad de miembros. Alimenta el
// selector de grupos del frontend.
export const SELECT_ALL_GROUPS = `
SELECT g.GroupId, g.GroupName, g.Description,
       COUNT(gm.StockId) AS MemberCount
FROM StockGroups g
LEFT JOIN StockGroupMembers gm ON gm.GroupId = g.GroupId
GROUP BY g.GroupId, g.GroupName, g.Description
ORDER BY g.GroupName;
`;

// Existencia de un grupo por id. Se usa antes de tocar sus miembros:
// sin esto, agregar a un grupo inexistente fallaría por FK con un error
// genérico en vez de un 404 claro.
export const SELECT_GROUP_BY_ID = `
SELECT GroupId, GroupName
FROM StockGroups
WHERE GroupId = @GroupId;
`;

// Trae un grupo con todos sus miembros (símbolo incluido) en una sola
// consulta. LEFT JOIN para que un grupo recién creado sin acciones
// todavía devuelva igual la fila del grupo (con Stocks/Symbol en NULL).
export const SELECT_GROUP_WITH_MEMBERS = `
SELECT g.GroupId, g.GroupName,
       s.StockId, s.Symbol
FROM StockGroups g
LEFT JOIN StockGroupMembers gm ON gm.GroupId = g.GroupId
LEFT JOIN Stocks s ON s.StockId = gm.StockId
WHERE g.GroupId = @GroupId;
`;

// Crea un grupo de acciones y devuelve el GroupId generado.
export const INSERT_GROUP = `
INSERT INTO StockGroups (GroupName, Description)
VALUES (@GroupName, @Description);

SELECT CAST(SCOPE_IDENTITY() AS INT) AS GroupId;
`;

// Renombra un grupo. Sólo toca el nombre: si actualizara también la
// descripción, un renombrado sin descripción la borraría sin querer.
export const UPDATE_GROUP_NAME = `
UPDATE StockGroups
SET GroupName = @GroupName
WHERE GroupId = @GroupId;
`;

// Borra un grupo. El CASCADE de StockGroupMembers limpia sus membresías;
// las acciones en sí NO se borran (pueden pertenecer a otros grupos o
// existir sueltas).
export const DELETE_GROUP = `
DELETE FROM StockGroups
WHERE GroupId = @GroupId;
`;

// Asocia una acción existente a un grupo.
export const ADD_STOCK_TO_GROUP = `
INSERT INTO StockGroupMembers (GroupId, StockId)
VALUES (@GroupId, @StockId);
`;

// Saca una acción de un grupo (no borra la acción ni el grupo).
export const REMOVE_STOCK_FROM_GROUP = `
DELETE FROM StockGroupMembers
WHERE GroupId = @GroupId AND StockId = @StockId;
`;

// ============================================================
// Vaciado total (panel de opciones)
// ============================================================

// Las FKs en cascada limpian precios, RSI, cotizaciones y membresías;
// hacen falta los dos DELETE porque borrar acciones no borra los grupos
// (quedarían vacíos) y viceversa.
export const DELETE_ALL_GROUPS = `DELETE FROM StockGroups;`;
export const DELETE_ALL_STOCKS = `DELETE FROM Stocks;`;