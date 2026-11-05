const express = require("express");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../lib/panel-permissions");
const cashbackService = require("../services/cashback");
const topups = require("../services/wallet-admin-topups");

const router = express.Router();
router.use(authenticate, requirePermission("settings.manage"));

router.get("/settings", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ settings: await cashbackService.getCashbackSettings() });
  } catch (err) {
    res.status(500).json({ message: err.message || "دریافت تنظیمات کش‌بک ناموفق بود" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    res.json({ settings: await cashbackService.saveCashbackSettings(req.body || {}) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "ذخیره تنظیمات کش‌بک ناموفق بود" });
  }
});

router.use("/wallet-topups", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (req.user.role !== "admin") return res.status(403).json({ message: "شارژ کیف پول فقط برای مدیر مجاز است." });
  next();
});

function topupRoute(action) {
  return async (req, res) => {
    try {
      const result = await action(req.user, req.body || {});
      if (result.invalid) return res.status(401).json({ message: "کد تأیید اشتباه است." });
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({ message: error.status ? error.message : "انجام عملیات کیف پول ممکن نشد." });
    }
  };
}

router.get("/wallet-topups", topupRoute(async () => ({ entries: await topups.listTopups() })));
router.post("/wallet-topups/lookup", topupRoute((_admin, body) => topups.findCustomer(body.phone)));
router.post("/wallet-topups", topupRoute(topups.requestTopup));
router.post("/wallet-topups/confirm", topupRoute(topups.confirmTopup));

module.exports = router;
