const express = require("express");
const { authenticate } = require("../middleware/auth");
const ordersService = require("../services/orders");
const zibal = require("../services/zibal");
const { query } = require("../db");

const router = express.Router();

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/** Start Zibal payment for an existing awaiting_payment order. */
router.post("/zibal/request", authenticate, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) {
      throw httpError("orderId الزامی است", 400, "VALIDATION_ERROR");
    }

    const order = await ordersService.getOrderWithItems(orderId);
    ordersService.assertOrderAccess(order, req.user);

    if (order.status === "paid" || order.status === "confirmed") {
      throw httpError("این سفارش قبلاً پرداخت شده است", 400, "ALREADY_PAID");
    }

    if (order.status !== "awaiting_payment" && order.status !== "pending") {
      throw httpError(
        "این سفارش قابل پرداخت نیست",
        400,
        "INVALID_ORDER_STATUS",
      );
    }

    const digital = await query('SELECT amount FROM download_purchases WHERE order_id=$1',[order.id]);
    if (digital.rowCount && process.env.NODE_ENV==='production' && (!process.env.ZIBAL_MERCHANT || process.env.ZIBAL_MERCHANT==='zibal')) throw httpError('درگاه واقعی خرید فایل هنوز تنظیم نشده است',503,'PAYMENT_CONFIG');
    if (digital.rowCount && Number(digital.rows[0].amount)!==Number(order.total_price)) throw httpError('مبلغ سفارش فایل نامعتبر است');
    const payment = await zibal.requestPayment({
      amountToman: order.total_price,
      orderId: order.id,
      description: `سفارش چاپ احسان #${order.id.slice(0, 8)}`,
      mobile: order.user_phone || req.user.phone || null,
    });

    await query(
      `UPDATE orders
       SET payment_track_id = $1,
           status = 'awaiting_payment'
       WHERE id = $2`,
      [payment.trackId, order.id],
    );

    res.json({
      trackId: payment.trackId,
      paymentUrl: payment.paymentUrl,
      orderId: order.id,
    });
  } catch (err) {
    console.error("Zibal request failed:", err.message);
    res.status(err.status || 500).json({
      message: err.message || "خطا در ایجاد پرداخت",
      code: err.code,
    });
  }
});

/**
 * Verify payment after Zibal browser callback.
 * Auth optional: tracked by payment_track_id.
 */
router.post("/zibal/verify", async (req, res) => {
  try {
    const trackId = Number(req.body?.trackId || req.query?.trackId);
    const successFlag = String(
      req.body?.success ?? req.query?.success ?? "",
    ).trim();

    if (!Number.isFinite(trackId) || trackId <= 0) {
      throw httpError("trackId نامعتبر است", 400, "INVALID_TRACK");
    }

    const orderResult = await query(
      `SELECT id, user_id, status, total_price, payment_track_id, payment_ref_number
       FROM orders
       WHERE payment_track_id = $1
       LIMIT 1`,
      [trackId],
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw httpError("سفارش مرتبط با این پرداخت یافت نشد", 404, "NOT_FOUND");
    }

    if (order.status === "paid" && order.payment_ref_number) {
      return res.json({
        ok: true,
        alreadyPaid: true,
        orderId: order.id,
        refNumber: order.payment_ref_number,
        message: "پرداخت قبلاً تایید شده است",
      });
    }

    if (successFlag === "0") {
      return res.json({
        ok: false,
        orderId: order.id,
        message: "پرداخت توسط کاربر لغو یا ناموفق شد",
        code: "PAYMENT_FAILED",
      });
    }

    const verify = await zibal.verifyPayment(trackId);
    const result = Number(verify.result);

    if (result === 100 || result === 201) {
      if (verify.amount != null && Number(verify.amount)!==Number(order.total_price)*10) throw httpError('مبلغ تأییدشده با سفارش مطابقت ندارد',400,'AMOUNT_MISMATCH');
      await query(
        `WITH paid AS (UPDATE orders
         SET status = 'paid',
             payment_ref_number = COALESCE($1, payment_ref_number),
             payment_card_number = COALESCE($2, payment_card_number),
             paid_at = COALESCE(paid_at, NOW())
         WHERE id = $3 RETURNING id) UPDATE download_purchases SET paid_at=COALESCE(paid_at,NOW()) WHERE order_id IN (SELECT id FROM paid)`,
        [
          verify.refNumber ? String(verify.refNumber) : null,
          verify.cardNumber ? String(verify.cardNumber) : null,
          order.id,
        ],
      );

      return res.json({
        ok: true,
        orderId: order.id,
        refNumber: verify.refNumber || order.payment_ref_number || null,
        cardNumber: verify.cardNumber || null,
        message:
          zibal.VERIFY_RESULT_FA[result] || "پرداخت با موفقیت تایید شد",
      });
    }

    res.json({
      ok: false,
      orderId: order.id,
      result,
      message:
        zibal.VERIFY_RESULT_FA[result] ||
        verify.message ||
        "تایید پرداخت ناموفق بود",
      code: "VERIFY_FAILED",
    });
  } catch (err) {
    console.error("Zibal verify failed:", err.message);
    res.status(err.status || 500).json({
      message: err.message || "خطا در تایید پرداخت",
      code: err.code,
    });
  }
});

module.exports = router;
