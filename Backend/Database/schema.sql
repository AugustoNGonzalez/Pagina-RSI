-- =====================================================================
-- Esquema de base de datos del proyecto RSI.
-- Guarda las acciones trackeadas, su histórico de precios diarios, el
-- RSI calculado por acción/período, la última cotización conocida, y
-- las agrupaciones que define el usuario.
--
-- OJO: este script DROPEA las tablas antes de crearlas. Correrlo sobre
-- una base con datos borra todo el histórico (recuperable: se vuelve a
-- descargar de Yahoo al sincronizar).
-- =====================================================================

IF DB_ID('RSI_Project') IS NULL CREATE DATABASE RSI_Project;
GO
USE RSI_Project;
GO

-- Se dropean en orden inverso a las dependencias (FK) para no romper
DROP TABLE IF EXISTS StockRSI;
DROP TABLE IF EXISTS StockLastQuote;
DROP TABLE IF EXISTS StockGroupMembers;
DROP TABLE IF EXISTS StockGroups;
DROP TABLE IF EXISTS StockPrices;
DROP TABLE IF EXISTS Stocks;
GO

-- =========================
-- STOCKS
-- Una fila por símbolo trackeado (ej: AAPL). Es la tabla "padre" de la
-- que cuelgan precios, RSI, última cotización y membresías de grupo.
-- Los metadatos se graban UNA vez, al alta (patrón get-or-create): si
-- una empresa se renombra, el dato queda viejo hasta que se re-cargue.
-- =========================
CREATE TABLE Stocks (
    StockId INT IDENTITY PRIMARY KEY,
    Symbol NVARCHAR(20) NOT NULL UNIQUE,     -- Ticker, ej: "AAPL"
    LongName NVARCHAR(150) NULL,             -- Nombre completo (viene del meta de Yahoo)
    ShortName NVARCHAR(100) NULL,            -- Reservado: hoy no se lee (fallback si falta LongName)
    Exchange NVARCHAR(50) NULL,              -- Bolsa donde cotiza (exchangeName de Yahoo)
    Currency NVARCHAR(10) NULL,              -- Reservado: hoy no se lee
    InstrumentType NVARCHAR(50) NULL,        -- EQUITY, ETF, etc. Reservado: hoy no se lee
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- =========================
-- STOCK PRICES
-- Velas diarias COMPLETADAS. La vela en curso del día nunca se guarda
-- acá: su epoch es inestable (cambia entre fetches) y su cierre es
-- parcial, así que vive sólo en memoria durante el sync.
--
-- (StockId, Epoch) es la PK clustered: ordena físicamente las velas por
-- acción y tiempo, que es el patrón de lectura del cálculo de RSI.
-- PriceDate es columna calculada (derivada de Epoch, en UTC) y no lleva
-- índice propio: la PK ya cubre ese orden.
-- =========================
CREATE TABLE StockPrices (
    StockId INT NOT NULL,
    Epoch BIGINT NOT NULL,
    PriceDate AS DATEADD(SECOND, Epoch % 86400, DATEADD(DAY, Epoch / 86400, CONVERT(DATETIME2(0), '1970-01-01T00:00:00', 126))) PERSISTED,
    OpenPrice  DECIMAL(18,6) NULL,
    HighPrice  DECIMAL(18,6) NULL,
    LowPrice   DECIMAL(18,6) NULL,
    ClosePrice DECIMAL(18,6) NULL,           -- Único precio que usa el cálculo de RSI
    Volume BIGINT NULL,
    CONSTRAINT PK_StockPrices
        PRIMARY KEY (StockId, Epoch),
    CONSTRAINT FK_StockPrices_Stocks
        FOREIGN KEY (StockId) REFERENCES Stocks(StockId)
        ON DELETE CASCADE                    -- Al borrar la acción, se borran sus velas
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
-- Última cotización conocida por acción (1 fila por StockId). Es la
-- única tabla que se pisa (upsert) en cada sincronización: acá sí va el
-- precio VIVO intradía, no el cierre de la última vela completada.
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

-- =========================
-- RSI
-- Un valor de RSI por acción, por vela (Epoch) y por período (RSIPeriod).
-- Sólo de velas completadas: el RSI vivo intradía se calcula en memoria
-- durante el sync y viaja en la respuesta, no se persiste.
-- El período forma parte de la clave para poder tener a futuro varias
-- ventanas (14, 21, etc.) sin pisarse entre sí.
-- =========================
CREATE TABLE StockRSI (
    StockId INT NOT NULL,
    Epoch BIGINT NOT NULL,
    RSIPeriod INT NOT NULL,
    RSI DECIMAL(6,3) NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_StockRSI
        PRIMARY KEY (StockId, RSIPeriod, Epoch),
    CONSTRAINT FK_StockRSI_Stocks
        FOREIGN KEY (StockId) REFERENCES Stocks(StockId)
        ON DELETE CASCADE,                   -- Al borrar la acción, se borra su RSI
    CONSTRAINT CK_StockRSI_Range
        CHECK (RSI >= 0 AND RSI <= 100)      -- Rechaza valores imposibles de RSI
);
GO