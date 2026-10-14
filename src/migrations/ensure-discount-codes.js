const { query } = require("../db");

async function ensureDiscountCodes() {
  await query(`
    CREATE TABLE IF NOT EXISTS discount_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
      discount_value INTEGER NOT NULL CHECK (discount_value > 0),
      minimum_order INTEGER NOT NULL DEFAULT 0 CHECK (minimum_order >= 0),
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS subtotal_price INTEGER,
      ADD COLUMN IF NOT EXISTS discount_code TEXT,
      ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS shipping_fee INTEGER NOT NULL DEFAULT 0
  `);
}

module.exports = { ensureDiscountCodes };
