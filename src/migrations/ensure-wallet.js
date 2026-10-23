const { query } = require("../db");

async function ensureWallet() {
  await query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN (
        'order_wallet_payment',
        'order_cancel_refund',
        'late_payment_refund'
      )),
      amount BIGINT NOT NULL CHECK (amount <> 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'wallet_transactions_type_check'
          AND (
            pg_get_constraintdef(oid) NOT LIKE '%cashback_reward%'
            OR pg_get_constraintdef(oid) NOT LIKE '%cashback_reversal%'
          )
      ) THEN
        ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_type_check'
      ) THEN
        ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check CHECK (type IN (
          'order_wallet_payment',
          'order_cancel_refund',
          'late_payment_refund',
          'cashback_reward',
          'cashback_reversal'
        ));
      END IF;
    END $$
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_order_type_uidx
      ON wallet_transactions (order_id, type)
      WHERE order_id IS NOT NULL
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx
      ON wallet_transactions (user_id, created_at DESC)
  `);
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS wallet_amount BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_before_wallet BIGINT
  `);
}

module.exports = { ensureWallet };
