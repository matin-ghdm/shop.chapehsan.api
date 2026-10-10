const { query } = require("../db");

async function ensureDesignImagesColumn() {
  await query("ALTER TABLE designs ADD COLUMN IF NOT EXISTS image_paths TEXT[] NOT NULL DEFAULT '{}'");
}

module.exports = { ensureDesignImagesColumn };
