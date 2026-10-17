const { query } = require("../db");

async function ensureOrderInvoiceColumns() {
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS invoice_type TEXT,
      ADD COLUMN IF NOT EXISTS invoice_name TEXT,
      ADD COLUMN IF NOT EXISTS invoice_national_id TEXT,
      ADD COLUMN IF NOT EXISTS invoice_economic_code TEXT,
      ADD COLUMN IF NOT EXISTS invoice_registration_number TEXT,
      ADD COLUMN IF NOT EXISTS invoice_phone TEXT,
      ADD COLUMN IF NOT EXISTS invoice_address TEXT,
      ADD COLUMN IF NOT EXISTS invoice_postal_code TEXT,
      ADD COLUMN IF NOT EXISTS invoice_issued_at TIMESTAMPTZ
  `);
}

module.exports = { ensureOrderInvoiceColumns };
