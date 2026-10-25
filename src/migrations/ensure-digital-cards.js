const { query } = require("../db");

async function ensureDigitalCards() {
  await query(`
    CREATE TABLE IF NOT EXISTS digital_cards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT 'کارت جدید',
      template TEXT NOT NULL DEFAULT 'corporate',
      accent_color TEXT NOT NULL DEFAULT '#1e4f9c',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','trial','active','expired')),
      trial_started_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE digital_cards ADD COLUMN IF NOT EXISTS access_exempt BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`CREATE INDEX IF NOT EXISTS digital_cards_user_idx ON digital_cards(user_id, created_at DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS digital_card_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id UUID NOT NULL REFERENCES digital_cards(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_months INTEGER NOT NULL CHECK (plan_months IN (6,12)),
      amount BIGINT NOT NULL CHECK (amount >= 0),
      order_id UUID UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_subscription_card_idx ON digital_card_subscriptions(card_id, ends_at DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS digital_card_events (
      id BIGSERIAL PRIMARY KEY,
      card_id UUID NOT NULL REFERENCES digital_cards(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN ('view','mobile','phone','map','messenger','social','website','email','vcf')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_event_card_idx ON digital_card_events(card_id, created_at DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS digital_card_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    INSERT INTO digital_card_settings(key, value) VALUES
      ('trial_days', '7'::jsonb),
      ('plan_6_price', '490000'::jsonb),
      ('plan_12_price', '790000'::jsonb)
    ON CONFLICT(key) DO NOTHING
  `);
}

module.exports = { ensureDigitalCards };
