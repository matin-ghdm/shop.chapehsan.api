const { query } = require("../db");

async function ensureServiceRequests() {
  await query(`
    CREATE TABLE IF NOT EXISTS service_requests (
      id BIGSERIAL PRIMARY KEY,
      service_slug TEXT NOT NULL,
      service_label TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      item_description TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      details TEXT,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'contacted', 'closed'))
    )
  `);
  await query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`CREATE INDEX IF NOT EXISTS service_requests_created_idx ON service_requests (created_at DESC)`);
}

module.exports = { ensureServiceRequests };
