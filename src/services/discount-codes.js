const { query } = require("../db");

function fail(message, status = 400, code = "INVALID_DISCOUNT_CODE") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function validateInput(input) {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) throw fail("کد تخفیف معتبر نیست");
  const discountType = input.discount_type;
  const discountValue = Number(input.discount_value);
  const minimumOrder = Number(input.minimum_order || 0);
  if (!["percent", "fixed"].includes(discountType)) throw fail("نوع تخفیف معتبر نیست");
  if (!Number.isInteger(discountValue) || discountValue < 1 || (discountType === "percent" && discountValue > 99)) {
    throw fail("مقدار تخفیف معتبر نیست");
  }
  if (!Number.isSafeInteger(minimumOrder) || minimumOrder < 0) throw fail("حداقل مبلغ سفارش معتبر نیست");
  const startsAt = input.starts_at ? new Date(input.starts_at) : null;
  const endsAt = input.ends_at ? new Date(input.ends_at) : null;
  if ((startsAt && Number.isNaN(startsAt.valueOf())) || (endsAt && Number.isNaN(endsAt.valueOf()))) throw fail("تاریخ تخفیف معتبر نیست");
  if (startsAt && endsAt && startsAt >= endsAt) throw fail("پایان تخفیف باید بعد از شروع آن باشد");
  return { code, discountType, discountValue, minimumOrder, startsAt, endsAt, isActive: input.is_active !== false };
}

async function listDiscountCodes() {
  const result = await query(`SELECT id, code, discount_type, discount_value, minimum_order, starts_at, ends_at, is_active, created_at, updated_at FROM discount_codes ORDER BY created_at DESC`);
  return result.rows;
}

async function saveDiscountCode(input, id = null) {
  const value = validateInput(input);
  const fields = [value.code, value.discountType, value.discountValue, value.minimumOrder, value.startsAt, value.endsAt, value.isActive];
  try {
    const result = id
      ? await query(`UPDATE discount_codes SET code=$1, discount_type=$2, discount_value=$3, minimum_order=$4, starts_at=$5, ends_at=$6, is_active=$7, updated_at=NOW() WHERE id=$8 RETURNING *`, [...fields, id])
      : await query(`INSERT INTO discount_codes(code, discount_type, discount_value, minimum_order, starts_at, ends_at, is_active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, fields);
    if (!result.rows[0]) throw fail("کد تخفیف پیدا نشد", 404, "NOT_FOUND");
    return result.rows[0];
  } catch (err) {
    if (err.code === "23505") throw fail("این کد تخفیف قبلاً ثبت شده است", 409, "CODE_EXISTS");
    throw err;
  }
}

async function calculateDiscount(codeInput, subtotal, client = { query }) {
  const code = normalizeCode(codeInput);
  const amount = Number(subtotal);
  if (!code || !Number.isSafeInteger(amount) || amount < 1) throw fail("کد تخفیف یا مبلغ سفارش معتبر نیست");
  const result = await client.query(
    `SELECT code, discount_type, discount_value, minimum_order
       FROM discount_codes
      WHERE code=$1 AND is_active=TRUE
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())`,
    [code]
  );
  const row = result.rows[0];
  if (!row) throw fail("کد تخفیف نامعتبر یا منقضی شده است");
  if (amount < Number(row.minimum_order)) throw fail(`حداقل مبلغ سفارش برای این کد ${Number(row.minimum_order).toLocaleString("fa-IR")} تومان است`);
  const discountAmount = row.discount_type === "percent"
    ? Math.floor((amount * Number(row.discount_value)) / 100)
    : Math.min(amount - 1, Number(row.discount_value));
  if (discountAmount < 1) throw fail("مبلغ سفارش برای استفاده از این کد کافی نیست");
  return { code: row.code, discount_amount: discountAmount, subtotal: amount, total_after_discount: amount - discountAmount };
}

async function deleteDiscountCode(id) {
  const result = await query(`DELETE FROM discount_codes WHERE id=$1 RETURNING id`, [id]);
  return result.rowCount > 0;
}

module.exports = { listDiscountCodes, saveDiscountCode, calculateDiscount, deleteDiscountCode };
