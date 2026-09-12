require("dotenv").config();
const { query } = require("../src/db");

async function main() {
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_track_id BIGINT,
      ADD COLUMN IF NOT EXISTS payment_ref_number TEXT,
      ADD COLUMN IF NOT EXISTS payment_card_number TEXT,
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_track_id_uidx
      ON orders (payment_track_id)
      WHERE payment_track_id IS NOT NULL
  `);

  console.log("orders payment columns ready");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
