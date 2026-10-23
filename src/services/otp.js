const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../db");
const smsir = require("./smsir");

const JWT_SECRET = process.env.JWT_SECRET || "chapehsan-secret-change-me";
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const OTP_VERIFY_TOKEN_TTL = process.env.OTP_VERIFY_TOKEN_TTL || "15m";

const ALLOWED_PURPOSES = new Set(["register", "login", "reset_password", "admin_login"]);

function httpError(message, status = 400, code = "OTP_ERROR") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizePhone(phone) {
  let value = String(phone || "").trim().replace(/\D/g, "");
  if (value.length === 10 && value.startsWith("9")) {
    value = `0${value}`;
  }
  if (!/^09\d{9}$/.test(value)) {
    throw httpError("شماره موبایل معتبر نیست", 400, "INVALID_PHONE");
  }
  return value;
}

function normalizePurpose(purpose) {
  const value = String(purpose || "register").trim().toLowerCase();
  if (!ALLOWED_PURPOSES.has(value)) {
    throw httpError("نوع درخواست OTP نامعتبر است", 400, "INVALID_PURPOSE");
  }
  return value;
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function latestOtp(phone, purpose) {
  const result = await query(
    `SELECT id, phone, purpose, code_hash, attempts, expires_at, verified_at, consumed_at, created_at
     FROM otp_codes
     WHERE phone = $1 AND purpose = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone, purpose],
  );
  return result.rows[0] || null;
}

async function createOtp(normalizedPhone, normalizedPurpose) {
  const recent = await latestOtp(normalizedPhone, normalizedPurpose);
  if (recent) {
    const createdAt = new Date(recent.created_at).getTime();
    const elapsed = (Date.now() - createdAt) / 1000;
    const isUsable = !recent.consumed_at && new Date(recent.expires_at).getTime() > Date.now();
    if (isUsable && elapsed < OTP_RESEND_SECONDS) {
      const wait = Math.ceil(OTP_RESEND_SECONDS - elapsed);
      throw httpError(`لطفاً ${wait} ثانیه دیگر دوباره تلاش کنید`, 429, "OTP_RATE_LIMIT");
    }
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  const hasSmsConfig =
    String(process.env.SMSIR_API_KEY || "").trim() &&
    Number(process.env.SMSIR_OTP_TEMPLATE_ID || 0);
  if (!hasSmsConfig && process.env.NODE_ENV === "production") {
    throw httpError("سرویس پیامک پیکربندی نشده است", 500, "SMS_CONFIG");
  }
  const inserted = await query(
    `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [normalizedPhone, normalizedPurpose, codeHash, expiresAt],
  );

  if (hasSmsConfig) {
    try {
      await smsir.sendOtp(normalizedPhone, code);
    } catch (error) {
      await query("DELETE FROM otp_codes WHERE id = $1", [inserted.rows[0].id]);
      throw error;
    }
  } else {
    console.log(`[OTP dev] phone=${normalizedPhone} purpose=${normalizedPurpose} code=${code}`);
  }

  return { otpId: String(inserted.rows[0].id), code, hasSmsConfig };
}

async function sendOtp({ phone, purpose = "register" }) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedPurpose = normalizePurpose(purpose);

  if (normalizedPurpose === "register") {
    const existing = await query(
      `SELECT id FROM users WHERE phone = $1 LIMIT 1`,
      [normalizedPhone],
    );
    if (existing.rows[0]) {
      throw httpError(
        "این شماره قبلاً ثبت‌نام کرده است. وارد شوید",
        409,
        "PHONE_EXISTS",
      );
    }
  }

  if (normalizedPurpose === "reset_password") {
    const existing = await query(
      `SELECT id FROM users WHERE phone = $1 AND is_active IS DISTINCT FROM FALSE LIMIT 1`,
      [normalizedPhone],
    );
    if (!existing.rows[0]) {
      // Return the same response as a real send so this endpoint does not
      // disclose whether a phone number has an account.
      return {
        phone: normalizedPhone,
        purpose: normalizedPurpose,
        expiresInSeconds: OTP_TTL_MINUTES * 60,
        resendAfterSeconds: OTP_RESEND_SECONDS,
      };
    }
  }

  const { code, hasSmsConfig } = await createOtp(normalizedPhone, normalizedPurpose);

  return {
    phone: normalizedPhone,
    purpose: normalizedPurpose,
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    resendAfterSeconds: OTP_RESEND_SECONDS,
    ...(process.env.NODE_ENV !== "production" && !hasSmsConfig
      ? { devCode: code }
      : {}),
  };
}

async function sendAdminLoginOtp(phone) {
  const normalizedPhone = normalizePhone(phone);
  const recent = await latestOtp(normalizedPhone, "admin_login");
  if (recent && !recent.consumed_at && new Date(recent.expires_at).getTime() > Date.now()) {
    const elapsed = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsed < OTP_RESEND_SECONDS) {
      return { otpId: String(recent.id), alreadySent: true };
    }
  }
  try {
    const { otpId, code, hasSmsConfig } = await createOtp(normalizedPhone, "admin_login");
    return {
      otpId,
      alreadySent: false,
      ...(process.env.NODE_ENV !== "production" && !hasSmsConfig ? { devCode: code } : {}),
    };
  } catch (error) {
    if (error.code !== "OTP_RATE_LIMIT") throw error;
    const latest = await latestOtp(normalizedPhone, "admin_login");
    if (latest && !latest.consumed_at && new Date(latest.expires_at).getTime() > Date.now()) {
      return { otpId: String(latest.id), alreadySent: true };
    }
    throw error;
  }
}

async function consumeAdminLoginOtp({ phone, otpId, code }) {
  const normalizedPhone = normalizePhone(phone);
  const rawCode = String(code || "").trim();
  if (!/^\d{6}$/.test(rawCode) || !/^[1-9]\d*$/.test(String(otpId || ""))) {
    throw httpError("کد تأیید معتبر نیست", 400, "OTP_INVALID");
  }

  const client = await require("../db").pool.connect();
  let failure = null;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM otp_codes
       WHERE id = $1 AND phone = $2 AND purpose = 'admin_login'
       FOR UPDATE`,
      [otpId, normalizedPhone],
    );
    const row = result.rows[0];
    if (!row) failure = httpError("کد ورود پیدا نشد. دوباره وارد شوید", 404, "OTP_NOT_FOUND");
    else if (row.consumed_at) failure = httpError("این کد قبلاً استفاده شده است", 409, "OTP_TOKEN_USED");
    else if (new Date(row.expires_at).getTime() < Date.now()) failure = httpError("کد ورود منقضی شده است. دوباره وارد شوید", 410, "OTP_EXPIRED");
    else if (row.attempts >= OTP_MAX_ATTEMPTS) failure = httpError("تعداد تلاش بیش از حد مجاز است. دوباره وارد شوید", 429, "OTP_MAX_ATTEMPTS");
    else if (!(await bcrypt.compare(rawCode, row.code_hash))) {
      await client.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1", [row.id]);
      failure = httpError("کد تأیید اشتباه است", 401, "OTP_INVALID");
    } else {
      await client.query("UPDATE otp_codes SET verified_at = NOW(), consumed_at = NOW(), attempts = attempts + 1 WHERE id = $1", [row.id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (failure) throw failure;
  return true;
}

function signVerificationToken(phone, purpose, otpId) {
  return jwt.sign({ phone, purpose, otpId: String(otpId), type: "otp_verified" }, JWT_SECRET, {
    expiresIn: OTP_VERIFY_TOKEN_TTL,
  });
}

async function verifyOtp({ phone, code, purpose = "register" }) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedPurpose = normalizePurpose(purpose);
  const rawCode = String(code || "").trim();

  if (!/^\d{6}$/.test(rawCode)) {
    throw httpError("کد تأیید باید ۶ رقم باشد", 400, "INVALID_CODE");
  }

  const row = await latestOtp(normalizedPhone, normalizedPurpose);
  if (!row) {
    throw httpError("کد تأیید یافت نشد. دوباره درخواست دهید", 404, "OTP_NOT_FOUND");
  }

  if (row.consumed_at) {
    throw httpError("کد تأیید قبلاً استفاده شده است", 409, "OTP_TOKEN_USED");
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw httpError("کد تأیید منقضی شده است", 410, "OTP_EXPIRED");
  }

  if (row.verified_at) {
    return {
      phone: normalizedPhone,
      purpose: normalizedPurpose,
      verificationToken: signVerificationToken(normalizedPhone, normalizedPurpose, row.id),
      alreadyVerified: true,
    };
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw httpError(
      "تعداد تلاش بیش از حد مجاز است. کد جدید بگیرید",
      429,
      "OTP_MAX_ATTEMPTS",
    );
  }

  const ok = await bcrypt.compare(rawCode, row.code_hash);
  if (!ok) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [
      row.id,
    ]);
    throw httpError("کد تأیید اشتباه است", 401, "OTP_INVALID");
  }

  await query(
    `UPDATE otp_codes SET verified_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
    [row.id],
  );

  return {
    phone: normalizedPhone,
    purpose: normalizedPurpose,
    verificationToken: signVerificationToken(normalizedPhone, normalizedPurpose, row.id),
  };
}

function getVerificationTokenPayload(token, phone, purpose) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedPurpose = normalizePurpose(purpose);

  if (!token) {
    throw httpError("کد تأیید موبایل الزامی است", 400, "OTP_REQUIRED");
  }

  let payload;
  try {
    payload = jwt.verify(String(token), JWT_SECRET);
  } catch {
    throw httpError(
      "کد تأیید منقضی شده است. دوباره درخواست دهید",
      401,
      "OTP_TOKEN_EXPIRED",
    );
  }

  if (
    payload?.type !== "otp_verified" ||
    payload.phone !== normalizedPhone ||
    payload.purpose !== normalizedPurpose
  ) {
    throw httpError("کد تأیید معتبر نیست", 401, "OTP_TOKEN_INVALID");
  }

  return payload;
}

function assertVerificationToken(token, phone, purpose) {
  getVerificationTokenPayload(token, phone, purpose);
  return true;
}

module.exports = {
  sendOtp,
  sendAdminLoginOtp,
  consumeAdminLoginOtp,
  verifyOtp,
  assertVerificationToken,
  getVerificationTokenPayload,
  normalizePhone,
};
