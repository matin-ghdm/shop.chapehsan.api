const { query } = require("../db");

async function ensureUserFavoritesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_type VARCHAR(32) NOT NULL,
      item_key VARCHAR(140) NOT NULL,
      title VARCHAR(180) NOT NULL,
      href VARCHAR(500) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, item_type, item_key)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS user_favorites_user_created_idx
      ON user_favorites (user_id, created_at DESC)
  `);
}

module.exports = { ensureUserFavoritesTable };
