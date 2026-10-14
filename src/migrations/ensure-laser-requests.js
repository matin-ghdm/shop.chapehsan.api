const { query } = require("../db");

async function ensureLaserRequests() {
  await query(`
    CREATE TABLE IF NOT EXISTS laser_requests (
      id BIGSERIAL PRIMARY KEY,
      service TEXT NOT NULL CHECK (service IN ('fiber', 'co2')),
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      material TEXT NOT NULL,
      item_description TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      dimensions TEXT,
      material_provided_by TEXT NOT NULL CHECK (material_provided_by IN ('customer', 'business', 'unsure')),
      needed_by TEXT,
      artwork_note TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'contacted', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS laser_requests_created_idx ON laser_requests (created_at DESC)`);
}

module.exports = { ensureLaserRequests };
