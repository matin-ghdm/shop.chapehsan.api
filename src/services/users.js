const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../db");
const otpService = require("./otp");

const JWT_SECRET = process.env.JWT_SECRET || "chapehsan-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const SAFE_COLUMNS = "id, name, lname, phone, email, role, created_at, is_active";

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    lname: row.lname,
    phone: row.phone,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function findByPhone(phone) {
  const result = await query(
    `SELECT id, name, lname, phone, email, password_hash, role, created_at, is_active
     FROM users WHERE phone = $1`,
    [phone]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await query(
    `SELECT ${SAFE_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function listUsers() {
  const result = await query(
    `SELECT ${SAFE_COLUMNS} FROM users WHERE is_active = TRUE ORDER BY created_at DESC`
  );
  return result.rows.map(toPublicUser);
}

async function register(raw = {}) {
  const name = raw.name ?? raw.firstName ?? raw.first_name;
  const lname = raw.lname ?? raw.lastName ?? raw.last_name;
  const phone = String(raw.phone ?? raw.mobile ?? "").trim();
  const email = raw.email ? String(raw.email).trim() : null;
  const password = raw.password;
  const otpToken = raw.otpToken ?? raw.verificationToken ?? null;

  if (!name || !lname || !phone || !password) {
    const missing = [];
    if (!name) missing.push("name");
    if (!lname) missing.push("lname");
    if (!phone) missing.push("phone");
    if (!password) missing.push("password");
    const error = new Error(
      `فیلدهای الزامی ناقص است: ${missing.join(", ")}`
    );
    error.status = 400;
    error.code = "VALIDATION_ERROR";
    error.fields = missing;
    throw error;
  }

  if (password.length < 6) {
    const error = new Error("رمز عبور باید حداقل ۶ کاراکتر باشد");
    error.status = 400;
    error.code = "WEAK_PASSWORD";
    throw error;
  }

  otpService.assertVerificationToken(otpToken, phone, "register");

  const existing = await findByPhone(phone);
  if (existing) {
    const error = new Error("این شماره قبلاً ثبت‌نام کرده است. لطفاً وارد شوید");
    error.status = 409;
    error.code = "PHONE_EXISTS";
    throw error;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, lname, phone, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, NULL)
       RETURNING ${SAFE_COLUMNS}`,
      [String(name).trim(), String(lname).trim(), phone, email, passwordHash]
    );

    const user = result.rows[0];
    return {
      user: toPublicUser(user),
      token: signToken(user),
    };
  } catch (err) {
    if (err.code === "23505") {
      const error = new Error("این شماره قبلاً ثبت‌نام کرده است. لطفاً وارد شوید");
      error.status = 409;
      error.code = "PHONE_EXISTS";
      throw error;
    }
    console.error("Register DB error:", err);
    const error = new Error(err.message || "خطای دیتابیس در ثبت‌نام");
    error.status = 500;
    error.code = "DB_ERROR";
    throw error;
  }
}

async function login({ phone, password }) {
  if (!phone || !password) {
    const error = new Error("شماره موبایل و رمز عبور الزامی است");
    error.status = 400;
    throw error;
  }

  const user = await findByPhone(phone);
  if (!user || user.is_active === false) {
    const error = new Error("شماره موبایل یا رمز عبور اشتباه است");
    error.status = 401;
    throw error;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const error = new Error("شماره موبایل یا رمز عبور اشتباه است");
    error.status = 401;
    throw error;
  }

  return {
    user: toPublicUser(user),
    token: signToken(user),
  };
}

async function updateUser(id, payload = {}, actor = null) {
  const current = await findById(id);
  if (!current) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const { name, lname, phone, email, password, role, current_password: currentPassword } = payload;

  if (actor?.id === id) {
    if (phone !== undefined || email !== undefined) {
      const error = new Error("تغییر شماره یا ایمیل نیازمند تأیید مالکیت حساب است");
      error.status = 403;
      error.code = "IDENTITY_VERIFICATION_REQUIRED";
      throw error;
    }
    if (role !== undefined) {
      const error = new Error("تغییر نقش کاربری مجاز نیست");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    if (password !== undefined) {
      if (!currentPassword) {
        const error = new Error("برای تغییر رمز، رمز فعلی را وارد کنید");
        error.status = 400;
        error.code = "CURRENT_PASSWORD_REQUIRED";
        throw error;
      }
      const secretResult = await query("SELECT password_hash FROM users WHERE id = $1", [id]);
      const valid = await bcrypt.compare(String(currentPassword), secretResult.rows[0]?.password_hash || "");
      if (!valid) {
        const error = new Error("رمز فعلی نادرست است");
        error.status = 401;
        error.code = "INVALID_CURRENT_PASSWORD";
        throw error;
      }
    }
  }

  if (name !== undefined && !String(name).trim()) {
    const error = new Error("نام نمی‌تواند خالی باشد");
    error.status = 400;
    throw error;
  }
  if (lname !== undefined && !String(lname).trim()) {
    const error = new Error("نام خانوادگی نمی‌تواند خالی باشد");
    error.status = 400;
    throw error;
  }
  if (password !== undefined && String(password).length < 6) {
    const error = new Error("رمز عبور باید حداقل ۶ کاراکتر باشد");
    error.status = 400;
    error.code = "WEAK_PASSWORD";
    throw error;
  }

  if (phone && phone !== current.phone) {
    const taken = await findByPhone(phone);
    if (taken) {
      const error = new Error("Phone number already registered");
      error.status = 409;
      throw error;
    }
  }

  const fields = [];
  const values = [];
  let i = 1;

  if (name !== undefined) {
    fields.push(`name = $${i++}`);
    values.push(String(name).trim());
  }
  if (lname !== undefined) {
    fields.push(`lname = $${i++}`);
    values.push(String(lname).trim());
  }
  if (phone !== undefined) {
    fields.push(`phone = $${i++}`);
    values.push(phone);
  }
  if (email !== undefined) {
    fields.push(`email = $${i++}`);
    values.push(email || null);
  }
  if (password !== undefined) {
    if (!password) {
      const error = new Error("password cannot be empty");
      error.status = 400;
      throw error;
    }
    fields.push(`password_hash = $${i++}`);
    values.push(await bcrypt.hash(password, 10));
  }
  if (role !== undefined) {
    const normalized = role === null ? null : String(role).trim().toLowerCase();
    if (normalized !== null && normalized !== "admin" && normalized !== "user") {
      const error = new Error("نقش باید ادمین یا بدون نقش باشد");
      error.status = 400;
      throw error;
    }
    fields.push(`role = $${i++}`);
    values.push(normalized === "user" ? null : normalized);
  }

  if (fields.length === 0) {
    const error = new Error("No fields to update");
    error.status = 400;
    throw error;
  }

  values.push(id);
  const result = await query(
    `UPDATE users SET ${fields.join(", ")}
     WHERE id = $${i}
     RETURNING ${SAFE_COLUMNS}`,
    values
  );

  return toPublicUser(result.rows[0]);
}

async function deactivateAdminUser(id) {
  const result = await query(
    `UPDATE users
     SET is_active = FALSE, role = NULL
     WHERE id = $1 AND is_active = TRUE AND lower(btrim(role)) = 'admin'
     RETURNING ${SAFE_COLUMNS}`,
    [id]
  );

  if (!result.rows[0]) {
    const error = new Error("کاربر مدیریتی پیدا نشد");
    error.status = 404;
    throw error;
  }

  return toPublicUser(result.rows[0]);
}

module.exports = {
  JWT_SECRET,
  register,
  login,
  updateUser,
  deactivateAdminUser,
  findById,
  listUsers,
  toPublicUser,
};
