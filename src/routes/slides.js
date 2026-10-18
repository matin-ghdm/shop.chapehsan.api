const express = require("express");
const slidesService = require("../services/slides");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../lib/panel-permissions");

const router = express.Router();

const requireSlidesAccess = requirePermission("slides.manage");

// Public: active slides for frontend
router.get("/", async (req, res) => {
  try {
    const slides = await slidesService.listSlides({
      placement: req.query.placement || null,
      activeOnly: true,
    });
    res.json({ slides });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت اسلایدها",
      code: err.code,
    });
  }
});

// Admin: all slides including inactive
router.get("/admin/all", authenticate, requireSlidesAccess, async (req, res) => {
  try {
    const slides = await slidesService.listSlides({
      placement: req.query.placement || null,
      activeOnly: false,
    });
    res.json({ slides });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت اسلایدها",
      code: err.code,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const slide = await slidesService.findById(req.params.id);
    if (!slide || !slide.is_active) {
      return res.status(404).json({ message: "اسلاید پیدا نشد", code: "NOT_FOUND" });
    }
    res.json({ slide });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت اسلاید",
      code: err.code,
    });
  }
});

router.post("/", authenticate, requireSlidesAccess, async (req, res) => {
  try {
    const slide = await slidesService.createSlide(req.body);
    res.status(201).json({ slide });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در ایجاد اسلاید",
      code: err.code,
    });
  }
});

router.put("/:id", authenticate, requireSlidesAccess, async (req, res) => {
  try {
    const slide = await slidesService.updateSlide(req.params.id, req.body);
    res.json({ slide });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در بروزرسانی اسلاید",
      code: err.code,
    });
  }
});

router.delete("/:id", authenticate, requireSlidesAccess, async (req, res) => {
  try {
    const slide = await slidesService.deleteSlide(req.params.id);
    res.json({ message: "اسلاید حذف شد", slide });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در حذف اسلاید",
      code: err.code,
    });
  }
});

module.exports = router;
