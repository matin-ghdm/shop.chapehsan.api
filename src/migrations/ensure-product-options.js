const { query } = require("../db");
async function ensureProductOptions() {
  const enumType = await query("SELECT t.typname, n.nspname FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE a.attrelid='designs'::regclass AND a.attname='type' AND t.typtype='e'");
  if (enumType.rows[0]) {
    const quote = value => `"${value.replace(/"/g, '""')}"`;
    const { nspname, typname } = enumType.rows[0];
    await query(`ALTER TYPE ${quote(nspname)}.${quote(typname)} ADD VALUE IF NOT EXISTS 'occasion'`);
    await query(`ALTER TYPE ${quote(nspname)}.${quote(typname)} ADD VALUE IF NOT EXISTS 'decorative'`);
  }
  await query("ALTER TABLE designs ADD COLUMN IF NOT EXISTS product_options JSONB NOT NULL DEFAULT '{\"variants\":[]}'::jsonb");
}
module.exports = { ensureProductOptions };
