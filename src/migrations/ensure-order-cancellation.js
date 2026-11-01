const { query } = require("../db");
async function ensureOrderCancellation() {
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS canceled_by TEXT");
}
module.exports = { ensureOrderCancellation };
