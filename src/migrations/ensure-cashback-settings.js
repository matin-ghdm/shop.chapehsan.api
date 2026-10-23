const { query } = require("../db");

const DEFAULT_CASHBACK_SETTINGS = Object.freeze({ enabled: false, rules: [] });

async function ensureCashbackSettings() {
  await query(`
    CREATE TABLE IF NOT EXISTS cashback_settings (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      settings JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `INSERT INTO cashback_settings (id, settings)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(DEFAULT_CASHBACK_SETTINGS)],
  );
}

module.exports = { ensureCashbackSettings, DEFAULT_CASHBACK_SETTINGS };
