const { query } = require("../db");

async function ensureProductReviewsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_type VARCHAR(32) NOT NULL,
      item_key VARCHAR(140) NOT NULL,
      item_title VARCHAR(180) NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body VARCHAR(2000) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      admin_reply VARCHAR(2000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, item_type, item_key)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS product_reviews_public_idx
      ON product_reviews (item_type, item_key, status, created_at DESC)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS product_reviews_admin_idx
      ON product_reviews (status, created_at DESC)
  `);
}

module.exports = { ensureProductReviewsTable };
