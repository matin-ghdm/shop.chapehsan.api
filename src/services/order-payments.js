const { pool, query } = require("../db");
const orders = require("./orders");
const wallet = require("./wallet");
const zibal = require("./zibal");
const { awardCashback } = require("./cashback");

function paymentError(message, status = 400, code = "BAD_REQUEST") {
  return Object.assign(new Error(message), { status, code });
}

const paymentColumns = `id,user_id,status,total_price,wallet_amount,amount_before_wallet,paid_at,
  subtotal_price,discount_code,discount_amount,shipping_fee,rush_fee,payment_track_id,payment_ref_number,
  (SELECT download_id FROM download_purchases WHERE order_id=orders.id) AS download_id,
  (SELECT amount FROM download_purchases WHERE order_id=orders.id) AS digital_amount,
  (SELECT amount FROM digital_card_subscriptions WHERE order_id=orders.id) AS card_subscription_amount,
  (SELECT id FROM digital_card_subscriptions WHERE order_id=orders.id) AS card_subscription_id,
  (SELECT card_id FROM digital_card_subscriptions WHERE order_id=orders.id) AS card_subscription_card_id,
  (SELECT amount FROM digital_card_template_purchases WHERE order_id=orders.id) AS card_template_amount`;

async function loadOrder(db, id, lock = false) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw paymentError("شناسه سفارش معتبر نیست");
  }
  const result = await db.query(
    `SELECT ${paymentColumns} FROM orders WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [id],
  );
  return result.rows[0];
}

async function inTransaction(action) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function ensureOwner(order, user) {
  orders.assertOrderAccess(order, user);
  if (order.user_id !== user.id) throw paymentError("دسترسی غیرمجاز", 403, "FORBIDDEN");
}

function ensurePayable(order) {
  if (!["awaiting_payment", "pending"].includes(order.status) || order.paid_at) {
    throw paymentError("این سفارش قابل پرداخت نیست", 409, "INVALID_ORDER_STATUS");
  }
}

function checkDigitalPrice(order) {
  const amounts = [order.digital_amount, order.card_subscription_amount, order.card_template_amount]
    .filter(amount => amount != null);
  if (amounts.length > 1 || (amounts.length && Number(amounts[0]) !== Number(order.amount_before_wallet ?? order.total_price))) {
    throw paymentError("مبلغ یا نوع سفارش دیجیتال نامعتبر است", 400, "AMOUNT_MISMATCH");
  }
  return amounts.length > 0;
}

function breakdown(order, balance) {
  const remaining = Number(order.total_price);
  const walletAlreadyApplied = Number(order.wallet_amount || 0);
  let walletAmount = Math.min(Math.max(0, balance), remaining);
  if (remaining > walletAmount && remaining - walletAmount < zibal.MIN_PAYMENT_TOMAN) {
    walletAmount = Math.max(0, remaining - zibal.MIN_PAYMENT_TOMAN);
  }
  return {
    orderId: order.id,
    total: Number(order.amount_before_wallet ?? remaining + walletAlreadyApplied),
    balance,
    walletAlreadyApplied,
    walletAmount,
    amountDue: remaining - walletAmount,
  };
}

async function quote(orderId, user) {
  const order = await loadOrder({ query }, orderId);
  ensureOwner(order, user);
  ensurePayable(order);
  checkDigitalPrice(order);
  return breakdown(order, await wallet.getBalance(order.user_id));
}

async function lockAccount(client, order) {
  if (order.card_subscription_card_id) {
    await client.query("SELECT id FROM digital_cards WHERE id=$1 FOR UPDATE", [order.card_subscription_card_id]);
  }
  await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [order.user_id]);
}

async function settle(client, order, bank = {}) {
  await client.query(
    `UPDATE orders SET status='paid', paid_at=COALESCE(paid_at,NOW()),
       payment_ref_number=COALESCE($2,payment_ref_number),payment_card_number=COALESCE($3,payment_card_number)
     WHERE id=$1`, [order.id, bank.refNumber ? String(bank.refNumber) : null, bank.cardNumber ? String(bank.cardNumber) : null],
  );
  if (order.download_id) {
    await client.query("UPDATE download_purchases SET paid_at=COALESCE(paid_at,NOW()) WHERE order_id=$1", [order.id]);
  }
  if (order.card_template_amount != null) {
    await client.query("UPDATE digital_card_template_purchases SET paid_at=COALESCE(paid_at,NOW()) WHERE order_id=$1", [order.id]);
  }
  if (order.card_subscription_id) {
    await client.query(`
      WITH pending AS (
        SELECT s.id,s.card_id,s.plan_months,GREATEST(NOW(),COALESCE((
          SELECT MAX(active.ends_at) FROM digital_card_subscriptions active
          WHERE active.card_id=s.card_id AND active.starts_at IS NOT NULL AND active.ends_at>NOW()
        ),NOW())) AS starts_at
        FROM digital_card_subscriptions s WHERE s.order_id=$1 AND s.starts_at IS NULL FOR UPDATE OF s
      ), activated AS (
        UPDATE digital_card_subscriptions s SET starts_at=p.starts_at,
          ends_at=p.starts_at+(p.plan_months || ' months')::interval
        FROM pending p WHERE s.id=p.id RETURNING s.card_id
      )
      UPDATE digital_cards c SET status='active',updated_at=NOW() FROM activated a WHERE c.id=a.card_id
    `, [order.id]);
  }
  if (Number(order.total_price) > 0) await awardCashback(client, order);
}

async function notifySubscription(order) {
  if (!order?.card_subscription_id || !order.card_subscription_card_id) return;
  try {
    await require("./digital-card-notifications").enqueueNotification(
      order.card_subscription_card_id, "subscription_paid", `subscription_paid_${order.card_subscription_id}`,
    );
  } catch (error) {
    console.error("Could not queue subscription confirmation SMS:", error.message);
  }
}

async function confirmedBankPayment(trackId, bank, amount) {
  if (bank.amount == null) {
    const inquiry = await zibal.inquiryPayment(trackId);
    if (Number(inquiry.result) === 100 && Number(inquiry.status) === 1) bank = inquiry;
  }
  if (bank.amount == null || Number(bank.amount) !== Number(amount) * 10) {
    throw paymentError("مبلغ تأییدشده با سفارش مطابقت ندارد", 400, "AMOUNT_MISMATCH");
  }
  return bank;
}

function paidResult(order) {
  return { paid: true, orderId: order.id, downloadId: order.download_id || undefined };
}

async function start(orderId, user, confirmed) {
  const { result, settled } = await inTransaction(async client => {
    const order = await loadOrder(client, orderId, true);
    if (confirmed) ensureOwner(order, user);
    else orders.assertOrderAccess(order, user);
    if (confirmed && order.paid_at && order.status !== "canceled") return { result: paidResult(order) };
    ensurePayable(order);
    const digital = checkDigitalPrice(order);

    if (order.payment_track_id) {
      const prior = await zibal.verifyPayment(order.payment_track_id);
      if ([100, 201].includes(Number(prior.result))) {
        const confirmedBank = await confirmedBankPayment(order.payment_track_id, prior, order.total_price);
        await lockAccount(client, order);
        await settle(client, order, confirmedBank);
        return { result: paidResult(order), settled: order };
      }
      if (![202, 203].includes(Number(prior.result))) {
        throw paymentError("وضعیت پرداخت قبلی مشخص نیست. دوباره تلاش کنید.", 503, "PAYMENT_STATUS_UNKNOWN");
      }
    }

    await lockAccount(client, order);
    const amounts = breakdown(order, confirmed ? await wallet.getBalance(order.user_id, client) : 0);
    if (confirmed && (confirmed.walletAmount !== amounts.walletAmount || confirmed.amountDue !== amounts.amountDue)) {
      throw paymentError("موجودی یا مبلغ سفارش تغییر کرده است. دوباره مبلغ را بازبینی کنید.", 409, "PAYMENT_QUOTE_CHANGED");
    }
    if (!confirmed && amounts.amountDue <= 0) {
      throw paymentError("این سفارش با اعتبار کیف پول تسویه شده است", 400, "NO_PAYMENT_DUE");
    }
    if (amounts.amountDue > 0 && digital && process.env.NODE_ENV === "production"
        && (!process.env.ZIBAL_MERCHANT || process.env.ZIBAL_MERCHANT === "zibal")) {
      throw paymentError("درگاه واقعی خرید دیجیتال هنوز تنظیم نشده است", 503, "PAYMENT_CONFIG");
    }

    if (amounts.walletAmount > 0) {
      await client.query(`
        INSERT INTO wallet_transactions(user_id,order_id,type,amount)
        VALUES($1,$2,'order_wallet_payment',$3)
        ON CONFLICT (order_id,type) WHERE order_id IS NOT NULL DO UPDATE
        SET amount=wallet_transactions.amount+EXCLUDED.amount
      `, [order.user_id, order.id, -amounts.walletAmount]);
    }
    if (order.payment_track_id) {
      await client.query(
        "INSERT INTO superseded_zibal_payments(track_id,order_id,amount) VALUES($1,$2,$3)",
        [order.payment_track_id, order.id, order.total_price],
      );
    }
    const payment = amounts.amountDue > 0 ? await zibal.requestPayment({
      amountToman: amounts.amountDue, orderId: order.id,
      description: `سفارش چاپ احسان #${order.id.slice(0, 8)}`,
      mobile: user.id === order.user_id ? user.phone : null,
    }) : null;
    await client.query(`
      UPDATE orders SET total_price=$2, wallet_amount=$3, amount_before_wallet=$4,
        payment_track_id=$5, status='awaiting_payment' WHERE id=$1
    `, [order.id, amounts.amountDue, amounts.walletAlreadyApplied + amounts.walletAmount, amounts.total, payment?.trackId ?? null]);
    if (payment) return { result: { orderId: order.id, trackId: payment.trackId, paymentUrl: payment.paymentUrl } };
    await settle(client, { ...order, total_price: 0 });
    return { result: paidResult(order), settled: order };
  });
  await notifySubscription(settled);
  return result;
}

async function verify(trackId, successFlag) {
  const found = await query(`
    SELECT id FROM orders WHERE payment_track_id=$1
    UNION ALL SELECT order_id FROM superseded_zibal_payments WHERE track_id=$1
  `, [trackId]);
  const orderId = found.rows[0]?.id;
  if (!orderId) throw paymentError("سفارش مرتبط با این پرداخت یافت نشد", 404, "NOT_FOUND");
  const { result, settled } = await inTransaction(async client => {
    const order = await loadOrder(client, orderId, true);
    const response = { orderId, downloadId: order.download_id || undefined };
    const isCurrent = String(order.payment_track_id) === String(trackId);
    let previous;
    if (!isCurrent) {
      const archived = await client.query(
        "SELECT amount,refund_transaction_id FROM superseded_zibal_payments WHERE track_id=$1 AND order_id=$2",
        [trackId, orderId],
      );
      previous = archived.rows[0];
      if (!previous) throw paymentError("پرداخت پیدا نشد", 404, "NOT_FOUND");
      if (previous.refund_transaction_id) {
        return { result: { ok: true, orderId, message: "مبلغ پرداخت قبلی به کیف پول شما برگشت داده شد" } };
      }
    }
    if (isCurrent && order.paid_at && order.status !== "canceled") {
      return { result: { ...response, ok: true, alreadyPaid: true, refNumber: order.payment_ref_number, message: "پرداخت قبلاً تایید شده است" } };
    }
    if (successFlag === "0") {
      return { result: { ...response, ok: false, code: "PAYMENT_FAILED", message: "پرداخت توسط کاربر لغو یا ناموفق شد" } };
    }
    const verification = await zibal.verifyPayment(trackId);
    const code = Number(verification.result);
    if (![100, 201].includes(code)) {
      return { result: { ...response, ok: false, result: code, code: "VERIFY_FAILED",
        message: zibal.VERIFY_RESULT_FA[code] || verification.message || "تایید پرداخت ناموفق بود" } };
    }
    const bank = await confirmedBankPayment(trackId, verification, previous?.amount ?? order.total_price);
    await lockAccount(client, order);
    if (previous) {
      const credit = await client.query(`
        INSERT INTO wallet_transactions(user_id,type,amount)
        VALUES($1,'late_payment_refund',$2) RETURNING id
      `, [order.user_id, previous.amount]);
      await client.query(
        "UPDATE superseded_zibal_payments SET refund_transaction_id=$2 WHERE track_id=$1",
        [trackId, credit.rows[0].id],
      );
      return { result: { ok: true, orderId, message: "مبلغ پرداخت قبلی به کیف پول شما برگشت داده شد" } };
    }
    if (order.status === "canceled") {
      await wallet.addTransaction(client, { userId: order.user_id, orderId, type: "late_payment_refund", amount: Number(order.total_price) });
      await client.query(
        `UPDATE orders SET payment_ref_number=COALESCE($2,payment_ref_number),
          payment_card_number=COALESCE($3,payment_card_number) WHERE id=$1`,
        [orderId, bank.refNumber ? String(bank.refNumber) : null, bank.cardNumber ? String(bank.cardNumber) : null],
      );
      return { result: { ok: true, orderId, message: "پرداخت سفارش لغوشده به کیف پول مشتری برگشت داده شد" } };
    }
    checkDigitalPrice(order);
    await settle(client, order, bank);
    return { result: { ...response, ok: true, refNumber: bank.refNumber || null, cardNumber: bank.cardNumber || null,
      message: zibal.VERIFY_RESULT_FA[code] }, settled: order };
  });
  await notifySubscription(settled);
  return result;
}

module.exports = { quote, start, verify };
