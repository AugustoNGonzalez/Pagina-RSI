-- =====================================================================
-- Esquema de base de datos del proyecto RSI.
-- Guarda las acciones trackeadas, su histórico de velas (diarias y
-- horarias), la última cotización conocida y las agrupaciones que
-- define el usuario.
--
-- Los INDICADORES no se persisten: se calculan al vuelo desde las velas
-- en cada request. Con velas diarias y horarias el cálculo son
-- milisegundos, y persistirlos obligaría a una tabla por indicador y
-- plazo que además puede desincronizarse de los precios.
--
-- OJO: este script DROPEA las tablas antes de crearlas. Correrlo sobre
-- una base con datos borra todo el histórico (recuperable: se vuelve a
-- descargar de Yahoo al sincronizar) y los grupos (NO recuperables).
-- =====================================================================

IF DB_ID('RSI_Project') IS NULL CREATE DATABASE RSI_Project;
GO
USE RSI_Project;
GO

-- Se dropean en orden inverso a las dependencias (FK) para no romper
DROP TABLE IF EXISTS StockRSI;          -- de la versión anterior, ya no se usa
DROP TABLE IF EXISTS StockLastQuote;
DROP TABLE IF EXISTS StockGroupMembers;
DROP TABLE IF EXISTS StockGroups;
DROP TABLE IF EXISTS StockPrices;
DROP TABLE IF EXISTS Stocks;
GO

-- =========================
-- STOCKS
-- Una fila por símbolo trackeado (ej: AAPL). Es la tabla "padre" de la
-- que cuelgan velas, última cotización y membresías de grupo.
-- Los metadatos se graban UNA vez, al alta (patrón get-or-create): si
-- una empresa se renombra, el dato queda viejo hasta que se re-cargue.
-- =========================
CREATE TABLE Stocks (
    StockId INT IDENTITY PRIMARY KEY,
    Symbol NVARCHAR(20) NOT NULL UNIQUE,     -- Ticker, ej: "AAPL"
    LongName NVARCHAR(150) NULL,             -- Nombre completo (viene del meta de Yahoo)
    ShortName NVARCHAR(100) NULL,            -- Fallback si falta LongName
    Exchange NVARCHAR(50) NULL,              -- Bolsa donde cotiza (exchangeName de Yahoo)
    Currency NVARCHAR(10) NULL,              -- Se graba al alta; ninguna query lo vuelve a leer
    InstrumentType NVARCHAR(50) NULL,        -- EQUITY, ETF, etc. Idem: se graba pero no se consulta
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- =========================
-- STOCK PRICES
-- Velas COMPLETADAS, en los intervalos que Yahoo entrega como velas
-- reales: '1d' (diarias) y '1h' (horarias). El semanal NO se guarda: se
-- deriva agrupando las diarias, porque el cierre semanal ES el último
-- cierre diario de la semana.
--
-- La vela en curso nunca se guarda acá: su epoch es inestable (cambia
-- entre fetches) y su cierre es parcial, así que vive sólo en memoria
-- durante el sync.
--
-- (StockId, Interval, Epoch) es la PK clustered: agrupa físicamente las
-- velas por acción e intervalo, ordenadas por tiempo, que es el patrón
-- de lectura de todos los indicadores.
-- =========================
CREATE TABLE StockPrices (
    StockId INT NOT NULL,
    Interval NVARCHAR(5) NOT NULL,           -- '1d' | '1h' (los que Yahoo da como velas)
    Epoch BIGINT NOT NULL,
    PriceDate AS DATEADD(SECOND, Epoch % 86400, DATEADD(DAY, Epoch / 86400, CONVERT(DATETIME2(0), '1970-01-01T00:00:00', 126))) PERSISTED,
    OpenPrice  DECIMAL(18,6) NULL,
    HighPrice  DECIMAL(18,6) NULL,
    LowPrice   DECIMAL(18,6) NULL,
    ClosePrice DECIMAL(18,6) NULL,
    Volume BIGINT NULL,
    CONSTRAINT PK_StockPrices
        PRIMARY KEY (StockId, Interval, Epoch),
    CONSTRAINT FK_StockPrices_Stocks
        FOREIGN KEY (StockId) REFERENCES Stocks(StockId)
        ON DELETE CASCADE,                   -- Al borrar la acción, se borran sus velas
    CONSTRAINT CK_StockPrices_Interval
        CHECK (Interval IN ('1d', '1h'))
);
GO

-- =========================
-- STOCK GROUPS
-- Agrupaciones definidas por el usuario (ej: "Semiconductores") para
-- cargar de una vez un conjunto de acciones correlacionadas en la vista.
-- =========================
CREATE TABLE StockGroups (
    GroupId INT IDENTITY PRIMARY KEY,
    GroupName NVARCHAR(100) NOT NULL,
    Description NVARCHAR(255) NULL,          -- Reservado: hoy no se usa en la UI
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_StockGroups_Name UNIQUE (GroupName)  -- No permite dos grupos con igual nombre
);
GO

-- Tabla puente Grupo <-> Acción (relación muchos a muchos)
CREATE TABLE StockGroupMembers (
    GroupId INT NOT NULL,
    StockId INT NOT NULL,
    CONSTRAINT PK_StockGroupMembers
        PRIMARY KEY (GroupId, StockId),      -- Evita agregar la misma acción dos veces al mismo grupo
    CONSTRAINT FK_GroupMembers_Groups
        FOREIGN KEY (GroupId) REFERENCES StockGroups(GroupId)
        ON DELETE CASCADE,                   -- Borrar el grupo elimina sus membresías
    CONSTRAINT FK_GroupMembers_Stocks
        FOREIGN KEY (StockId) REFERENCES Stocks(StockId)
        ON DELETE CASCADE                    -- Borrar la acción la saca de todos los grupos
);
GO

-- =========================
-- LAST QUOTE
-- Última cotización conocida por acción (1 fila por StockId). No lleva
-- Interval: la cotización del momento es una sola, no depende del plazo
-- que esté mirando el usuario.
-- Es la única tabla que se pisa (upsert) en cada sincronización: acá va
-- el precio VIVO intradía, no el cierre de la última vela completada.
-- PreviousClose permite mostrar la variación diaria sin leer StockPrices.
-- UpdatedAt en UTC: el frontend lo convierte a hora local al mostrarlo.
-- =========================
CREATE TABLE StockLastQuote (
    StockId INT PRIMARY KEY,
    LastPrice DECIMAL(18,6) NOT NULL,
    PreviousClose DECIMAL(18,6) NULL,
    LastEpoch BIGINT NOT NULL,
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_LastQuote_Stocks
        FOREIGN KEY (StockId) REFERENCES Stocks(StockId)
        ON DELETE CASCADE
);
GO