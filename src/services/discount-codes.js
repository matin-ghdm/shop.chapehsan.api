const { query } = require("../db");
const { randomBytes } = require("node:crypto");

const PRODUCT_TYPE_LABELS = {
  taslit: "بنر تسلیت دیواری",
  stand: "بنر استندی",
  hamdardi: "ابراز همدردی",
  davati: "کارت دعوت",
  hajj: "بنر حجاج",
  karbala: "بنر کربلایی",
  occasion: "بنر مناسبتی",
  laser: "حکاکی لیزر",
  decorative: "تابلو و محصولات دکوراتیو",
  sarbarg: "سربرگ",
};
const DISCOUNT_TARGET_TYPES = new Set(["all", ...Object.keys(PRODUCT_TYPE_LABELS)]);

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
  const appliesToType = String(input.applies_to_type || "all").trim().toLowerCase();
  if (!["percent", "fixed"].includes(discountType)) throw fail("نوع تخفیف معتبر نیست");
  if (!DISCOUNT_TARGET_TYPES.has(appliesToType)) throw fail("محصول مشمول تخفیف معتبر نیست");
  if (!Number.isInteger(discountValue) || discountValue < 1 || (discountType === "percent" && discountValue > 99)) {
    throw fail("مقدار تخفیف معتبر نیست");
  }
  if (!Number.isSafeInteger(minimumOrder) || minimumOrder < 0) throw fail("حداقل مبلغ سفارش معتبر نیست");
  const startsAt = input.starts_at ? new Date(input.starts_at) : null;
  const endsAt = input.ends_at ? new Date(input.ends_at) : null;
  if ((startsAt && Number.isNaN(startsAt.valueOf())) || (endsAt && Number.isNaN(endsAt.valueOf()))) throw fail("تاریخ تخفیف معتبر نیست");
  if (startsAt && endsAt && startsAt >= endsAt) throw fail("پایان تخفیف باید بعد از شروع آن باشد");
  return { code, discountType, discountValue, minimumOrder, appliesToType, startsAt, endsAt, isActive: input.is_active !== false };
}

async function listDiscountCodes() {
  const result = await query(`SELECT id, code, discount_type, discount_value, minimum_order, applies_to_type, starts_at, ends_at, is_active, created_at, updated_at FROM discount_codes ORDER BY created_at DESC`);
  return result.rows;
}

async function generateUniqueCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `CH-${randomBytes(5).toString("hex").toUpperCase()}`;
    const existing = await query("SELECT 1 FROM discount_codes WHERE code=$1 LIMIT 1", [code]);
    if (!existing.rows[0]) return code;
  }
  throw fail("ساخت خودکار کد تخفیف ناموفق بود؛ دوباره تلاش کنید", 503, "CODE_GENERATION_FAILED");
}

async function saveDiscountCode(input, id = null) {
  const normalizedInput = { ...input };
  if (!id && !normalizeCode(normalizedInput.code)) normalizedInput.code = await generateUniqueCode();
  const value = validateInput(normalizedInput);
  const fields = [value.code, value.discountType, value.discountValue, value.minimumOrder, value.appliesToType, value.startsAt, value.endsAt, value.isActive];
  try {
    const result = id
      ? await query(`UPDATE discount_codes SET code=$1, discount_type=$2, discount_value=$3, minimum_order=$4, applies_to_type=$5, starts_at=$6, ends_at=$7, is_active=$8, updated_at=NOW() WHERE id=$9 RETURNING *`, [...fields, id])
      : await query(`INSERT INTO discount_codes(code, discount_type, discount_value, minimum_order, applies_to_type, starts_at, ends_at, is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, fields);
    if (!result.rows[0]) throw fail("کد تخفیف پیدا نشد", 404, "NOT_FOUND");
    return result.rows[0];
  } catch (err) {
    if (err.code === "23505") throw fail("این کد تخفیف قبلاً ثبت شده است", 409, "CODE_EXISTS");
    throw err;
  }
}

function subtotalForProductType(items, productType) {
  if (!Array.isArray(items) || items.length === 0) {
    throw fail("سبد خرید برای بررسی این کد تخفیف معتبر نیست");
  }
  let eligibleSubtotal = 0;
  for (const item of items) {
    const type = String(item?.design_type || item?.custom_data?.design_type || "").trim().toLowerCase();
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unit_price);
    if (!DISCOUNT_TARGET_TYPES.has(type) || type === "all" || !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
      throw fail("اطلاعات محصولات سبد خرید معتبر نیست");
    }
    if (type === productType) eligibleSubtotal += quantity * unitPrice;
  }
  if (!Number.isSafeInteger(eligibleSubtotal) || eligibleSubtotal < 1) {
    const label = PRODUCT_TYPE_LABELS[productType] || "محصول انتخاب‌شده";
    throw fail(`این کد فقط برای ${label} قابل استفاده است`);
  }
  return eligibleSubtotal;
}

async function calculateDiscount(codeInput, subtotal, client = { query }, items = null) {
  const code = normalizeCode(codeInput);
  const amount = Number(subtotal);
  if (!code || !Number.isSafeInteger(amount) || amount < 1) throw fail("کد تخفیف یا مبلغ سفارش معتبر نیست");
  const result = await client.query(
    `SELECT code, discount_type, discount_value, minimum_order, applies_to_type
       FROM discount_codes
      WHERE code=$1 AND is_active=TRUE
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())`,
    [code]
  );
  const row = result.rows[0];
  if (!row) throw fail("کد تخفیف نامعتبر یا منقضی شده است");
  const eligibleSubtotal = row.applies_to_type === "all"
    ? amount
    : subtotalForProductType(items, row.applies_to_type);
  const minimumBasis = row.applies_to_type === "all" ? amount : eligibleSubtotal;
  if (minimumBasis < Number(row.minimum_order)) throw fail(`حداقل مبلغ سفارش برای این کد ${Number(row.minimum_order).toLocaleString("fa-IR")} تومان است`);
  const discountAmount = row.discount_type === "percent"
    ? Math.floor((eligibleSubtotal * Number(row.discount_value)) / 100)
    : Math.min(eligibleSubtotal - 1, Number(row.discount_value));
  if (discountAmount < 1) throw fail("مبلغ سفارش برای استفاده از این کد کافی نیست");
  return { code: row.code, discount_amount: discountAmount, subtotal: amount, eligible_subtotal: eligibleSubtotal, applies_to_type: row.applies_to_type, total_after_discount: amount - discountAmount };
}

async function deleteDiscountCode(id) {
  const result = await query(`DELETE FROM discount_codes WHERE id=$1 RETURNING id`, [id]);
  return result.rowCount > 0;
}

module.exports = { listDiscountCodes, saveDiscountCode, calculateDiscount, deleteDiscountCode };
