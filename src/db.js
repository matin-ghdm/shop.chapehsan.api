const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

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