const { query } = require("../db");
const { DEFAULT_ORDER_SCHEDULE } = require("../services/order-schedule");

async function ensureOrderScheduleSettings() {
  await query(`
    CREATE TABLE IF NOT EXISTS order_schedule_settings (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      settings JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `INSERT INTO order_schedule_settings (id, settings)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(DEFAULT_ORDER_SCHEDULE)],
  );
}

module.exports = { ensureOrderScheduleSettings };
