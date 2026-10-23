const express = require("express");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../lib/panel-permissions");
const cashbackService = require("../services/cashback");

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

module.exports = router;
