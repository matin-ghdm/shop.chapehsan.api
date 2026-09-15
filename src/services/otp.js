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

const ALLOWED_PURPOSES = new Set(["register", "login", "reset_password"]);

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
    `SELECT id, phone, purpose, code_hash, attempts, expires_at, verified_at, created_at
     FROM otp_codes
     WHERE phone = $1 AND purpose = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone, purpose],
  );
  return result.rows[0] || null;
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

  const recent = await latestOtp(normalizedPhone, normalizedPurpose);
  if (recent && !recent.verified_at) {
    const createdAt = new Date(recent.created_at).getTime();
    const elapsed = (Date.now() - createdAt) / 1000;
    if (elapsed < OTP_RESEND_SECONDS) {
      const wait = Math.ceil(OTP_RESEND_SECONDS - elapsed);
      throw httpError(
        `لطفاً ${wait} ثانیه دیگر دوباره تلاش کنید`,
        429,
        "OTP_RATE_LIMIT",
      );
    }
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await query(
    `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [normalizedPhone, normalizedPurpose, codeHash, expiresAt],
  );

  const hasSmsConfig =
    String(process.env.SMSIR_API_KEY || "").trim() &&
    Number(process.env.SMSIR_OTP_TEMPLATE_ID || 0);

  if (hasSmsConfig) {
    await smsir.sendOtp(normalizedPhone, code);
  } else if (process.env.NODE_ENV !== "production") {
    console.log(
      `[OTP dev] phone=${normalizedPhone} purpose=${normalizedPurpose} code=${code}`,
    );
  } else {
    throw httpError(
      "سرویس پیامک پیکربندی نشده است",
      500,
      "SMS_CONFIG",
    );
  }

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

function signVerificationToken(phone, purpose) {
  return jwt.sign({ phone, purpose, type: "otp_verified" }, JWT_SECRET, {
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

  if (row.verified_at) {
    return {
      phone: normalizedPhone,
      purpose: normalizedPurpose,
      verificationToken: signVerificationToken(normalizedPhone, normalizedPurpose),
      alreadyVerified: true,
    };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw httpError("کد تأیید منقضی شده است", 410, "OTP_EXPIRED");
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
    verificationToken: signVerificationToken(normalizedPhone, normalizedPurpose),
  };
}

function assertVerificationToken(token, phone, purpose) {
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

  return true;
}

module.exports = {
  sendOtp,
  verifyOtp,
  assertVerificationToken,
  normalizePhone,
};
