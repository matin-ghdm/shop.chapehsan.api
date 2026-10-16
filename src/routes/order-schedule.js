const express = require("express");
const { authenticate } = require("../middleware/auth");
const scheduleService = require("../services/order-schedule");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ settings: await scheduleService.getOrderScheduleSettings() });
  } catch (err) {
    res.status(500).json({ message: "دریافت ساعت کاری ناموفق بود" });
  }
});

router.put("/", authenticate, async (req, res) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "فقط ادمین مجاز است", code: "FORBIDDEN" });
  }
  try {
    const settings = await scheduleService.saveOrderScheduleSettings(req.body || {});
    res.json({ settings });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "ذخیره ساعت کاری ناموفق بود" });
  }
});

module.exports = router;
