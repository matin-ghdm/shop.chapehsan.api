const express = require("express");
const designsService = require("../services/designs");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      message: "فقط ادمین مجاز است",
      code: "FORBIDDEN",
    });
  }
  next();
}

// Public: active designs only
router.get("/", async (req, res) => {
  try {
    const designs = await designsService.listDesigns({
      type: req.query.type || null,
      category: req.query.category || null,
      activeOnly: true,
    });
    res.json({ designs });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت طرح‌ها",
      code: err.code,
    });
  }
});

// Admin: all designs including inactive
router.get("/admin/all", authenticate, requireAdmin, async (req, res) => {
  try {
    const designs = await designsService.listDesigns({
      type: req.query.type || null,
      category: req.query.category || null,
      activeOnly: false,
    });
    res.json({ designs });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت طرح‌ها",
      code: err.code,
    });
  }
});

router.put("/type/:type/price", authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await designsService.updatePriceByType(
      req.params.type,
      req.body.price
    );
    res.json({
      message: `قیمت ${result.updated_count} طرح از نوع ${result.type} بروزرسانی شد`,
      ...result,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در بروزرسانی قیمت",
      code: err.code,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const raw = req.params.id;
    const type = req.query.type || null;
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        raw
      );

    const design = isUuid
      ? await designsService.findById(raw)
      : await designsService.findByCode(raw, type);

    if (!design || !design.is_active) {
      return res
        .status(404)
        .json({ message: "طرح پیدا نشد", code: "NOT_FOUND" });
    }
    res.json({ design });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت طرح",
      code: err.code,
    });
  }
});

router.post("/", authenticate, requireAdmin, async (req, res) => {
  try {
    const design = await designsService.createDesign(req.body);
    res.status(201).json({ design });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در ایجاد طرح",
      code: err.code,
    });
  }
});

router.put("/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const design = await designsService.updateDesign(req.params.id, req.body);
    res.json({ design });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در بروزرسانی طرح",
      code: err.code,
    });
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const design = await designsService.deleteDesign(req.params.id);
    res.json({ message: "طرح حذف شد", design });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در حذف طرح",
      code: err.code,
    });
  }
});

module.exports = router;
