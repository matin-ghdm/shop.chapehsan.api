const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "chapehsan",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "r@123456",
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function testConnection() {
  const result = await query("SELECT NOW() AS now, current_database() AS database");
  return result.rows[0];
}

module.exports = {
  pool,
  query,
  testConnection,
};
