const { query } = require("../db");
async function ensureDesignUpdatedAtColumn() {
  await query("ALTER TABLE designs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ");
}
module.exports = { ensureDesignUpdatedAtColumn };
