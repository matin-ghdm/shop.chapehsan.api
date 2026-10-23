const { query } = require("../db");
const { DEFAULT_CASHBACK_SETTINGS } = require("../migrations/ensure-cashback-settings");

const MAX_AMOUNT = 1_000_000_000_000;

function normalizeCashbackSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const seen = new Set();
  const rules = (Array.isArray(source.rules) ? source.rules : [])
    .slice(0, 50)
    .map((rule) => ({
      minPurchaseAmount: Number(rule?.minPurchaseAmount),
      cashbackAmount: Number(rule?.cashbackAmount),
    }))
    .filter((rule) => {
      if (!Number.isSafeInteger(rule.minPurchaseAmount) || rule.minPurchaseAmount < 1 || rule.minPurchaseAmount > MAX_AMOUNT) return false;
      if (!Number.isSafeInteger(rule.cashbackAmount) || rule.cashbackAmount < 1 || rule.cashbackAmount > MAX_AMOUNT) return false;
      if (seen.has(rule.minPurchaseAmount)) return false;
      seen.add(rule.minPurchaseAmount);
      return true;
    })
    .sort((a, b) => a.minPurchaseAmount - b.minPurchaseAmount);

  return {
    enabled: source.enabled === true,
    rules,
  };
}

function validateCashbackSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  if (source.enabled !== undefined && typeof source.enabled !== "boolean") {
    throw Object.assign(new Error("وضعیت کش‌بک معتبر نیست"), { status: 400 });
  }
  if (source.rules !== undefined && !Array.isArray(source.rules)) {
    throw Object.assign(new Error("پله‌های کش‌بک معتبر نیستند"), { status: 400 });
  }
  if (Array.isArray(source.rules)) {
    if (source.rules.length > 50) throw Object.assign(new Error("حداکثر ۵۰ پله برای کش‌بک مجاز است"), { status: 400 });
    const thresholds = new Set();
    for (const rule of source.rules) {
      const minPurchaseAmount = Number(rule?.minPurchaseAmount);
      const cashbackAmount = Number(rule?.cashbackAmount);
      if (!Number.isSafeInteger(minPurchaseAmount) || minPurchaseAmount < 1 || minPurchaseAmount > MAX_AMOUNT) {
        throw Object.assign(new Error("حداقل مبلغ خرید باید عدد صحیح و بیشتر از صفر باشد"), { status: 400 });
      }
      if (!Number.isSafeInteger(cashbackAmount) || cashbackAmount < 1 || cashbackAmount > MAX_AMOUNT) {
        throw Object.assign(new Error("مبلغ کش‌بک باید عدد صحیح و بیشتر از صفر باشد"), { status: 400 });
      }
      if (thresholds.has(minPurchaseAmount)) {
        throw Object.assign(new Error("حداقل مبلغ خرید در پله‌ها نباید تکراری باشد"), { status: 400 });
      }
      thresholds.add(minPurchaseAmount);
    }
  }

  const settings = normalizeCashbackSettings(source);
  if (settings.enabled && settings.rules.length === 0) {
    throw Object.assign(new Error("برای فعال‌کردن کش‌بک، دست‌کم یک پله تعریف کنید"), { status: 400 });
  }
  return settings;
}

async function getCashbackSettings(runner = null) {
  const db = runner || { query };
  const result = await db.query("SELECT settings FROM cashback_settings WHERE id = 1");
  return normalizeCashbackSettings(result.rows[0]?.settings || DEFAULT_CASHBACK_SETTINGS);
}

async function saveCashbackSettings(value) {
  const settings = validateCashbackSettings(value);
  const result = await query(
    `INSERT INTO cashback_settings (id, settings, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE
       SET settings = EXCLUDED.settings, updated_at = NOW()
     RETURNING settings`,
    [JSON.stringify(settings)],
  );
  return normalizeCashbackSettings(result.rows[0].settings);
}

function eligiblePurchaseAmount(order) {
  const digitalAmount = Number(order.digital_amount || 0);
  if (digitalAmount > 0) {
    return Math.max(0, Math.min(digitalAmount, Number(order.total_price || 0)));
  }

  const subtotal = Number(order.subtotal_price || 0);
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0) return 0;
  const discountedProductAmount = Math.max(0, subtotal - Number(order.discount_amount || 0));
  const paidAfterAncillaryCosts = Math.max(
    0,
    Number(order.total_price || 0) - Number(order.shipping_fee || 0) - Number(order.rush_fee || 0),
  );
  return Math.min(discountedProductAmount, paidAfterAncillaryCosts);
}

async function awardCashback(client, order) {
  const settings = await getCashbackSettings(client);
  if (!settings.enabled) return null;

  const eligibleAmount = eligiblePurchaseAmount(order);
  const matchedRule = settings.rules.reduce(
    (best, rule) => eligibleAmount >= rule.minPurchaseAmount ? rule : best,
    null,
  );
  if (!matchedRule || !order.user_id || !order.id) return null;

  const inserted = await require("./wallet").addTransaction(client, {
    userId: order.user_id,
    orderId: order.id,
    type: "cashback_reward",
    amount: matchedRule.cashbackAmount,
  });
  return inserted ? matchedRule.cashbackAmount : null;
}

module.exports = {
  DEFAULT_CASHBACK_SETTINGS,
  normalizeCashbackSettings,
  validateCashbackSettings,
  getCashbackSettings,
  saveCashbackSettings,
  eligiblePurchaseAmount,
  awardCashback,
};
