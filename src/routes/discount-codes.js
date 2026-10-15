const express = require("express");
const { authenticate } = require("../middleware/auth");
const service = require("../services/discount-codes");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "فقط ادمین مجاز است", code: "FORBIDDEN" });
  next();
}

router.post("/validate", async (req, res) => {
  try {
    res.json(await service.calculateDiscount(req.body?.code, Number(req.body?.subtotal), undefined, req.body?.items));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "بررسی کد تخفیف ناموفق بود", code: err.code });
  }
});

router.get("/admin/all", authenticate, requireAdmin, async (_req, res) => {
  try { res.json({ discount_codes: await service.listDiscountCodes() }); }
  catch (err) { res.status(err.status || 500).json({ message: err.message || "دریافت کدهای تخفیف ناموفق بود", code: err.code }); }
});

router.post("/", authenticate, requireAdmin, async (req, res) => {
  try { res.status(201).json({ discount_code: await service.saveDiscountCode(req.body || {}) }); }
  catch (err) { res.status(err.status || 500).json({ message: err.message || "ثبت کد تخفیف ناموفق بود", code: err.code }); }
});

router.put("/:id", authenticate, requireAdmin, async (req, res) => {
  try { res.json({ discount_code: await service.saveDiscountCode(req.body || {}, req.params.id) }); }
  catch (err) { res.status(err.status || 500).json({ message: err.message || "ویرایش کد تخفیف ناموفق بود", code: err.code }); }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    if (!await service.deleteDiscountCode(req.params.id)) return res.status(404).json({ message: "کد تخفیف پیدا نشد", code: "NOT_FOUND" });
    res.json({ message: "کد تخفیف حذف شد" });
  } catch (err) { res.status(err.status || 500).json({ message: err.message || "حذف کد تخفیف ناموفق بود", code: err.code }); }
});

module.exports = router;
