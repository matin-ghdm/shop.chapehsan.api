const { query } = require("../db");

async function ensureOrderDeliverySchedule() {
  await query(
    "ALTER TABLE orders " +
      "ADD COLUMN IF NOT EXISTS delivery_date DATE, " +
      "ADD COLUMN IF NOT EXISTS delivery_time TIME, " +
      "ADD COLUMN IF NOT EXISTS next_business_day_confirmed BOOLEAN NOT NULL DEFAULT FALSE"
  );
}

module.exports = { ensureOrderDeliverySchedule };
