const { query } = require("../db");

async function ensureCustomerRoles() {
  const roleEnum = await query(`
    SELECT t.typname, n.nspname
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE a.attrelid = 'users'::regclass
      AND a.attname = 'role'
      AND t.typtype = 'e'
  `);
  if (roleEnum.rows[0]) {
    const { typname, nspname } = roleEnum.rows[0];
    const quote = (value) => `"${value.replace(/"/g, '""')}"`;
    await query(`ALTER TYPE ${quote(nspname)}.${quote(typname)} ADD VALUE IF NOT EXISTS 'staff'`);
  }

  await query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `);
  await query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  await query(`
    UPDATE users SET is_active = TRUE WHERE is_active IS NULL
  `);
  await query(`
    ALTER TABLE users
      ALTER COLUMN is_active SET DEFAULT TRUE,
      ALTER COLUMN is_active SET NOT NULL,
      ALTER COLUMN role DROP DEFAULT,
      ALTER COLUMN role DROP NOT NULL
  `);
}

module.exports = { ensureCustomerRoles };
