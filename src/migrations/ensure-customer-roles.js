const { query } = require("../db");

async function ensureCustomerRoles() {
  await query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
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
  await query(`
    UPDATE users
    SET role = CASE WHEN lower(btrim(role::text)) = 'admin' THEN 'admin' ELSE NULL END
    WHERE role IS DISTINCT FROM CASE
      WHEN lower(btrim(role::text)) = 'admin' THEN 'admin'
      ELSE NULL
    END
  `);
}

module.exports = { ensureCustomerRoles };
