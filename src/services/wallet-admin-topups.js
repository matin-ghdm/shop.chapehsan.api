const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { pool, query } = require("../db");
const { getBalance } = require("./wallet");
const { normalizePhone } = require("./otp");
const { sendOtp } = require("./smsir");

const maxAmount = 1_000_000_000_000;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

async function findCustomer(phone) {
  const result = await query(
    `SELECT id, name, lname, phone FROM users
     WHERE phone=$1 AND is_active IS DISTINCT FROM FALSE`,
    [normalizePhone(phone)],
  );
  const customer = result.rows[0];
  if (!customer) throw problem(404, "کاربری با این شماره پیدا نشد.");
  return { ...customer, balance: await getBalance(customer.id) };
}

async function requestTopup(admin, body) {
  const { userId, amount } = body;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (typeof userId !== "string" || !uuid.test(userId) || !Number.isSafeInteger(amount)
      || amount < 1 || amount > maxAmount || !reason || reason.length > 200) {
    throw problem(400, "کاربر، مبلغ و دلیل شارژ را بررسی کنید.");
  }
  const phone = normalizePhone(admin.phone);
  const adminName = [admin.name, admin.lname].filter(Boolean).join(" ") || "مدیر";
  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(100000, 1000000));
  const hash = await bcrypt.hash(code, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account = await client.query(
      `SELECT id FROM users WHERE id=$1 AND phone=$2 AND role='admin'
       AND is_active IS DISTINCT FROM FALSE FOR UPDATE`, [admin.id, phone],
    );
    if (!account.rowCount) throw problem(403, "حساب مدیر معتبر نیست.");
    const recent = await client.query(
      `SELECT 1 FROM wallet_admin_topups WHERE admin_id=$1
       AND created_at>NOW()-INTERVAL '60 seconds' LIMIT 1`, [admin.id],
    );
    if (recent.rowCount) throw problem(429, "برای ارسال دوبارهٔ کد، یک دقیقه صبر کنید.");
    const inserted = await client.query(
      `INSERT INTO wallet_admin_topups (id,admin_id,admin_name,admin_phone,user_id,amount,reason,code_hash,expires_at)
       SELECT $1,$2,$3,$4,id,$6,$7,$8,NOW()+INTERVAL '5 minutes'
       FROM users WHERE id=$5 AND is_active IS DISTINCT FROM FALSE`,
      [id, admin.id, adminName, phone, userId, amount, reason, hash],
    );
    if (!inserted.rowCount) throw problem(404, "کاربر پیدا نشد.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  try {
    await sendOtp(phone, code);
    await query("UPDATE wallet_admin_topups SET sent_at=NOW() WHERE id=$1", [id]);
  } catch {
    throw problem(502, "ارسال کد تأیید ممکن نشد. پس از یک دقیقه دوباره تلاش کنید.");
  }
  return { id, maskedPhone: phone.slice(0, 4) + "••••" + phone.slice(-3) };
}

async function confirmTopup(admin, { id, code }) {
  if (typeof id !== "string" || !uuid.test(id) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    throw problem(400, "کد تأیید باید شش رقم باشد.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT *, expires_at<=clock_timestamp() AS expired FROM wallet_admin_topups
       WHERE id=$1 AND admin_id=$2 AND admin_phone=$3 FOR UPDATE`,
      [id, admin.id, normalizePhone(admin.phone)],
    );
    const request = result.rows[0];
    if (!request || !request.sent_at) throw problem(404, "درخواست تأیید پیدا نشد.");
    if (!request.transaction_id) {
      if (request.expired) throw problem(410, "کد منقضی شده است. دوباره کد بگیرید.");
      if (request.attempts >= 5) throw problem(429, "تعداد تلاش‌ها تمام شده است. دوباره کد بگیرید.");
      if (!(await bcrypt.compare(code, request.code_hash))) {
        await client.query("UPDATE wallet_admin_topups SET attempts=attempts+1 WHERE id=$1", [id]);
        await client.query("COMMIT");
        return { invalid: true };
      }
      const recipient = await client.query(
        "SELECT id FROM users WHERE id=$1 AND is_active IS DISTINCT FROM FALSE FOR UPDATE",
        [request.user_id],
      );
      if (!recipient.rowCount) throw problem(404, "کاربر پیدا نشد.");
      const credit = await client.query(
        `INSERT INTO wallet_transactions (user_id,type,amount)
         VALUES ($1,'admin_topup',$2) RETURNING id`, [request.user_id, request.amount],
      );
      await client.query(
        `UPDATE wallet_admin_topups SET transaction_id=$2, confirmed_at=NOW(), code_hash=NULL
         WHERE id=$1`, [id, credit.rows[0].id],
      );
    }
    const balance = await getBalance(request.user_id, client);
    await client.query("COMMIT");
    return { balance, amount: Number(request.amount), reason: request.reason };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listTopups() {
  const result = await query(
    `SELECT a.id, a.admin_name, a.amount::float8 AS amount, a.reason, a.confirmed_at,
       u.name, u.lname, u.phone FROM wallet_admin_topups a JOIN users u ON u.id=a.user_id
     WHERE a.transaction_id IS NOT NULL ORDER BY a.confirmed_at DESC LIMIT 20`,
  );
  return result.rows;
}

module.exports = { findCustomer, requestTopup, confirmTopup, listTopups };
