const { query } = require("../db");

/** Idempotent schema for OTP verification codes. */
async function ensureOtpCodesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id BIGSERIAL PRIMARY KEY,
      phone VARCHAR(11) NOT NULL,
      purpose VARCHAR(32) NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      verified_at TIMESTAMPTZ,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    ALTER TABLE otp_codes
      ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS otp_codes_phone_purpose_idx
      ON otp_codes (phone, purpose, created_at DESC)
  `);
}

module.exports = { ensureOtpCodesTable };
