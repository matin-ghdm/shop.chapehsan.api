const { Pool } = require("pg");
require("dotenv").config();

function buildPoolConfig() {
  const useSsl =
    process.env.DB_SSL === "true" ||
    process.env.DB_SSL === "1" ||
    process.env.PGSSLMODE === "require";

  const ssl = useSsl ? { rejectUnauthorized: false } : false;

  if (process.env.DATABASE_URL) {
    let connectionString = process.env.DATABASE_URL;
    // Prefer IPv4 in local/dev to avoid localhost → ::1 hangs on Windows.
    if (process.env.NODE_ENV !== "production") {
      connectionString = connectionString.replace(
        /@localhost(?=[:/])/i,
        "@127.0.0.1",
      );
    }
    return {
      connectionString,
      ssl,
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30000,
      max: Number(process.env.DB_POOL_MAX) || 10,
    };
  }

  return {
    host: process.env.DB_HOST === "localhost"
      ? "127.0.0.1"
      : process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || "chapehsan",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    ssl,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30000,
    max: Number(process.env.DB_POOL_MAX) || 10,
  };
}

const pool = new Pool(buildPoolConfig());

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function testConnection() {
  const result = await query(
    "SELECT NOW() AS now, current_database() AS database"
  );
  return result.rows[0];
}

module.exports = {
  pool,
  query,
  testConnection,
};
