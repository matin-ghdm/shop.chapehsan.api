const { query } = require("../db");

async function ensureTelegramBotTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS telegram_bot_users (
      chat_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      phone TEXT,
      last_after_hours_notice_on DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS telegram_bot_sessions (
      chat_id BIGINT PRIMARY KEY REFERENCES telegram_bot_users(chat_id) ON DELETE CASCADE,
      step TEXT NOT NULL,
      request_kind TEXT NOT NULL,
      description TEXT,
      media_file_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS telegram_bot_requests (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL REFERENCES telegram_bot_users(chat_id),
      request_kind TEXT NOT NULL CHECK (request_kind IN ('custom_order', 'support')),
      description TEXT NOT NULL,
      media_file_id TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'answered', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query("ALTER TABLE telegram_bot_sessions ADD COLUMN IF NOT EXISTS media_file_id TEXT");
  await query("ALTER TABLE telegram_bot_requests ADD COLUMN IF NOT EXISTS media_file_id TEXT");

  await query(`
    CREATE INDEX IF NOT EXISTS telegram_bot_requests_status_created_idx
      ON telegram_bot_requests (status, created_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS telegram_bot_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

module.exports = { ensureTelegramBotTables };
