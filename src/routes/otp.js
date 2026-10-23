const express = require("express");
const otpService = require("../services/otp");

const router = express.Router();

router.post("/send", async (req, res) => {
  if (String(req.body?.purpose || "").trim().toLowerCase() === "admin_login") {
    return res.status(403).json({ message: "ارسال کد ورود مدیر فقط پس از بررسی رمز انجام می‌شود", code: "FORBIDDEN" });
  }
  try {
    const result = await otpService.sendOtp(req.body || {});
    res.json(result);
  } catch (err) {
    console.error("OTP send failed:", err.code || err.status, err.message);
    res.status(err.status || 500).json({
      message: err.message || "ارسال کد تأیید ناموفق بود",
      code: err.code || "OTP_SEND_FAILED",
    });
  }
});

router.post("/verify", async (req, res) => {
  if (String(req.body?.purpose || "").trim().toLowerCase() === "admin_login") {
    return res.status(403).json({ message: "تأیید کد ورود مدیر از مسیر ورود انجام می‌شود", code: "FORBIDDEN" });
  }
  try {
    const result = await otpService.verifyOtp(req.body || {});
    res.json(result);
  } catch (err) {
    console.error("OTP verify failed:", err.code || err.status, err.message);
    res.status(err.status || 500).json({
      message: err.message || "تأیید کد ناموفق بود",
      code: err.code || "OTP_VERIFY_FAILED",
    });
  }
});

module.exports = router;
