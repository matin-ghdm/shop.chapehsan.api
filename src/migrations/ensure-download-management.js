const { pool } = require('../db');

async function ensureDownloadManagement() {
  const client = await pool.connect();
  try {
    const enumType = await client.query(`SELECT t.typname, n.nspname FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE a.attrelid='downloads'::regclass AND a.attname='type' AND t.typtype='e'`);
    const quote = value => `"${value.replace(/"/g, '""')}"`;
    if (enumType.rows[0]) {
      const { nspname, typname } = enumType.rows[0];
      for (const value of ['image', 'banner', 'tasliat']) {
        await client.query(`ALTER TYPE ${quote(nspname)}.${quote(typname)} ADD VALUE IF NOT EXISTS '${value}'`);
      }
    }
    await client.query('BEGIN');
    const existing = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name='downloads' AND column_name='requires_login' AND table_schema=current_schema()`);
    await client.query(`ALTER TABLE downloads
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS requires_login BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS archive_password TEXT,
      ADD COLUMN IF NOT EXISTS preview_path TEXT,
      ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
      ADD COLUMN IF NOT EXISTS download_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS dimensions TEXT,
      ADD COLUMN IF NOT EXISTS software TEXT,
      ADD COLUMN IF NOT EXISTS usage_guide TEXT,
      ADD COLUMN IF NOT EXISTS usage_terms TEXT,
      ADD COLUMN IF NOT EXISTS related_product_path TEXT,
      ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS price BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS file_key TEXT,
      ADD COLUMN IF NOT EXISTS file_source TEXT`);
    await client.query(`CREATE TABLE IF NOT EXISTS download_purchases (
      order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
      download_id UUID NOT NULL REFERENCES downloads(id) ON DELETE RESTRICT,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      amount BIGINT NOT NULL CHECK (amount >= 100),
      name TEXT NOT NULL,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS download_purchases_owner ON download_purchases(user_id, download_id)`);
    if (!existing.rowCount) {
      await client.query(`UPDATE downloads SET requires_login=is_protected, archive_password=CASE WHEN is_protected THEN 'chapehsan.com' ELSE NULL END`);
    }
    const checks = await client.query(`SELECT conname FROM pg_constraint WHERE conrelid='downloads'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '\\mtype\\M'`);
    for (const row of checks.rows) {
      await client.query(`ALTER TABLE downloads DROP CONSTRAINT "${row.conname.replace(/"/g, '""')}"`);
    }
    await client.query(`ALTER TABLE downloads ADD CONSTRAINT downloads_type_check CHECK (type IN ('layer','pdf','image','banner','tasliat','map','other'))`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { ensureDownloadManagement };
