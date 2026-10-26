const { query } = require("../db");
const { DEFAULT_PLANS } = require("../services/digital-card-entitlements");

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
  await query(`ALTER TABLE digital_cards ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
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
  await query(`ALTER TABLE digital_card_subscriptions ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT 'bronze'`);
  await query(`ALTER TABLE digital_card_subscriptions ADD COLUMN IF NOT EXISTS entitlements_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await query(`UPDATE digital_card_subscriptions SET entitlements_snapshot=$1::jsonb WHERE entitlements_snapshot='{}'::jsonb`, [JSON.stringify({ tier: "bronze", ...DEFAULT_PLANS.bronze })]);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_subscription_user_idx ON digital_card_subscriptions(user_id, ends_at DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS digital_card_template_purchases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template TEXT NOT NULL CHECK (template IN ('luxury','shop','medical')),
      amount BIGINT NOT NULL CHECK (amount >= 100),
      order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_template_purchase_user_idx ON digital_card_template_purchases(user_id,template,paid_at)`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS digital_card_template_purchase_paid_unique_idx ON digital_card_template_purchases(user_id,template) WHERE paid_at IS NOT NULL`);
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
    CREATE TABLE IF NOT EXISTS digital_card_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id UUID NOT NULL REFERENCES digital_cards(id) ON DELETE CASCADE,
      notification_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('trial_started','trial_reminder','trial_expired','subscription_paid','subscription_reminder','subscription_expired')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(card_id, notification_key)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_notifications_due_idx ON digital_card_notifications(status,next_attempt_at) WHERE status IN ('pending','sending')`);
  await query(`
    CREATE TABLE IF NOT EXISTS digital_card_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id UUID NOT NULL REFERENCES digital_cards(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','archived')),
      ip_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_lead_owner_idx ON digital_card_leads(user_id,created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_lead_rate_idx ON digital_card_leads(card_id,ip_hash,created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_lead_card_time_idx ON digital_card_leads(card_id,created_at DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS digital_card_assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id UUID NOT NULL REFERENCES digital_cards(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blob_url TEXT NOT NULL UNIQUE,
      size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
      content_type TEXT NOT NULL,
      asset_kind TEXT NOT NULL CHECK (asset_kind IN ('logo','portrait','cover','gallery','product','catalog')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS digital_card_asset_owner_idx ON digital_card_assets(user_id,created_at)`);
  await query(`
    INSERT INTO digital_card_settings(key, value) VALUES
      ('trial_days', '7'::jsonb),
      ('plan_6_price', '490000'::jsonb),
      ('plan_12_price', '790000'::jsonb),
      ('template_luxury_price', '0'::jsonb),
      ('template_luxury_active', 'false'::jsonb),
      ('template_shop_price', '0'::jsonb),
      ('template_shop_active', 'false'::jsonb),
      ('template_medical_price', '0'::jsonb),
      ('template_medical_active', 'false'::jsonb),
      ('sms_enabled', 'false'::jsonb),
      ('sms_template_id', '0'::jsonb),
      ('sms_message_param', to_jsonb('MESSAGE'::text)),
      ('sms_link_param', to_jsonb('LINK'::text)),
      ('sms_reminder_days', '2'::jsonb),
      ('sms_trial_started', 'true'::jsonb),
      ('sms_trial_reminder', 'true'::jsonb),
      ('sms_trial_expired', 'true'::jsonb),
      ('sms_subscription_paid', 'true'::jsonb),
      ('sms_subscription_reminder', 'true'::jsonb),
      ('sms_subscription_expired', 'true'::jsonb)
    ON CONFLICT(key) DO NOTHING
  `);

  const defaults = [];
  for (const [tier, plan] of Object.entries(DEFAULT_PLANS)) {
    for (const [key, value] of Object.entries(plan.limits)) defaults.push([`plan_${tier}_${key}`, value]);
    for (const [key, value] of Object.entries(plan.features)) defaults.push([`plan_${tier}_${key}`, value]);
    if (tier !== "bronze") for (const months of [6, 12]) {
      defaults.push([`plan_${tier}_${months}_price`, 0]);
      defaults.push([`plan_${tier}_${months}_active`, false]);
    }
  }
  const params = defaults.flatMap(([key, value]) => [key, JSON.stringify(value)]);
  const valuesSql = defaults.map((_, index) => `($${index * 2 + 1},$${index * 2 + 2}::jsonb)`).join(",");
  await query(`INSERT INTO digital_card_settings(key,value) VALUES ${valuesSql} ON CONFLICT(key) DO NOTHING`, params);
  await query(`INSERT INTO digital_card_settings(key,value)
    SELECT 'plan_bronze_6_price',value FROM digital_card_settings WHERE key='plan_6_price'
    ON CONFLICT(key) DO NOTHING`);
  await query(`INSERT INTO digital_card_settings(key,value)
    SELECT 'plan_bronze_12_price',value FROM digital_card_settings WHERE key='plan_12_price'
    ON CONFLICT(key) DO NOTHING`);
  await query(`INSERT INTO digital_card_settings(key,value)
    SELECT 'plan_bronze_6_active',COALESCE((SELECT value FROM digital_card_settings WHERE key='plan_6_active'),'true'::jsonb)
    ON CONFLICT(key) DO NOTHING`);
  await query(`INSERT INTO digital_card_settings(key,value)
    SELECT 'plan_bronze_12_active',COALESCE((SELECT value FROM digital_card_settings WHERE key='plan_12_active'),'true'::jsonb)
    ON CONFLICT(key) DO NOTHING`);
}

module.exports = { ensureDigitalCards };
