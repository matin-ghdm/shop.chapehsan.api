const express = require("express");
const { authenticate } = require("../middleware/auth");
const payments = require("../services/order-payments");

const router = express.Router();

function sendError(res, error) {
  if (!error.status || error.status >= 500) console.error("Zibal payment failed:", error.message);
  res.status(error.status || 500).json({
    message: error.status ? error.message : "انجام عملیات پرداخت ممکن نشد",
    code: error.code,
  });
}

router.post("/zibal/quote", authenticate, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await payments.quote(String(req.body?.orderId || "").trim(), req.user));
  } catch (error) { sendError(res, error); }
});

router.post("/zibal/request", authenticate, async (req, res) => {
  try {
    const { orderId, walletAmount, amountDue } = req.body || {};
    const confirmsQuote = walletAmount !== undefined || amountDue !== undefined;
    if (confirmsQuote && (!Number.isSafeInteger(walletAmount) || walletAmount < 0 ||
      !Number.isSafeInteger(amountDue) || amountDue < 0)) {
      return res.status(400).json({ message: "مبلغ پرداخت معتبر نیست", code: "VALIDATION_ERROR" });
    }
    res.json(await payments.start(
      String(orderId || "").trim(), req.user, confirmsQuote ? { walletAmount, amountDue } : null,
    ));
  } catch (error) { sendError(res, error); }
});

router.post("/zibal/verify", async (req, res) => {
  try {
    const trackId = String(req.body?.trackId ?? req.query?.trackId ?? "").trim();
    if (!/^[1-9]\d{0,17}$/.test(trackId)) {
      return res.status(400).json({ message: "شناسه پرداخت نامعتبر است", code: "INVALID_TRACK" });
    }
    const success = String(req.body?.success ?? req.query?.success ?? "").trim();
    res.json(await payments.verify(trackId, success));
  } catch (error) { sendError(res, error); }
});

module.exports = router;
