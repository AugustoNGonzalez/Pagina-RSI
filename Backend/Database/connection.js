// Database/connection.js
// Maneja una única pool de conexiones a SQL Server, compartida por toda
// la app (patrón singleton), en vez de abrir una conexión nueva por request.
// La conexión es lazy: se abre en el primer request, no al importar este
// módulo. Por eso no importa si Node arranca antes que SQL Server.

import sql from "mssql";

// Variables de entorno obligatorias para poder conectar. Si falta alguna,
// la app ni siquiera debería intentar levantar el servidor.
const requiredEnv = ["DB_USER", "DB_PASSWORD", "DB_SERVER", "DB_NAME"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Variable de entorno faltante: ${key}`);
  }
}

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  pool: {
    max: 10,           // conexiones simultáneas máximas en el pool
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    // Conexión cifrada aceptando el certificado autofirmado que instala
    // SQL Server por defecto. Sirve para una instancia local o de red
    // doméstica; contra un servidor expuesto habría que usar un
    // certificado válido y trustServerCertificate en false.
    encrypt: true,
    trustServerCertificate: true
  },
  requestTimeout: 30000
};

// `pool` guarda la conexión ya establecida; `poolPromise` evita que dos
// llamadas concurrentes a getConnection() disparen dos intentos de
// conexión en paralelo mientras la primera todavía se está resolviendo.
let pool = null;
let poolPromise = null;

export async function getConnection() {
  // Pool caído sin haber emitido "error" (pasa con algunos cortes de
  // red): se descarta para forzar reconexión.
  if (pool && !pool.connected) {
    pool = null;
    poolPromise = null;
  }

  if (pool && pool.connected) return pool;

  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then(p => {
        pool = p;

        // Si el pool tira un error a nivel conexión (ej: se cae el
        // servidor), se descarta para que la próxima llamada a
        // getConnection() reconecte de cero en vez de seguir devolviendo
        // un pool roto.
        pool.on("error", err => {
          console.error("MSSQL pool error");
          console.error(err);
          pool = null;
          poolPromise = null;
        });

        return pool;
      })
      .catch(err => {
        poolPromise = null;
        console.error("DB connection error");
        console.error(err);
        throw err;
      });
  }

  return poolPromise;
}

export { sql };