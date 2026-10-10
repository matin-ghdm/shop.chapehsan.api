const { query } = require("../db");
async function ensureDesignBannerTextColumn() {
  await query("ALTER TABLE designs ADD COLUMN IF NOT EXISTS banner_text TEXT NOT NULL DEFAULT ''");
}
module.exports = { ensureDesignBannerTextColumn };
