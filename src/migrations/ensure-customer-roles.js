const { query } = require("../db");

async function ensureCustomerRoles() {
  await query(`
    ALTER TABLE users
      ALTER COLUMN role DROP DEFAULT,
      ALTER COLUMN role DROP NOT NULL
  `);
  await query(`
    UPDATE users
    SET role = CASE WHEN lower(btrim(role)) = 'admin' THEN 'admin' ELSE NULL END
    WHERE role IS DISTINCT FROM CASE
      WHEN lower(btrim(role)) = 'admin' THEN 'admin'
      ELSE NULL
    END
  `);
}

module.exports = { ensureCustomerRoles };
