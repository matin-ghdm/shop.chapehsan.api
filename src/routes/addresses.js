const express = require("express");
const addressesService = require("../services/addresses");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

router.get("/", async (req, res) => {
  try {
    const userId =
      req.user.role === "admin" ? req.query.user_id || null : req.user.id;
    const addresses = await addressesService.listAddresses({ userId });
    res.json({ addresses });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت آدرس‌ها",
      code: err.code,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const address = await addressesService.findById(req.params.id);
    addressesService.assertAddressAccess(address, req.user);
    res.json({ address });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت آدرس",
      code: err.code,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const address = await addressesService.createAddress(req.body, req.user);
    res.status(201).json({ address });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در ایجاد آدرس",
      code: err.code,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const address = await addressesService.updateAddress(
      req.params.id,
      req.body,
      req.user
    );
    res.json({ address });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در بروزرسانی آدرس",
      code: err.code,
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const address = await addressesService.deleteAddress(req.params.id, req.user);
    res.json({ message: "آدرس حذف شد", address });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در حذف آدرس",
      code: err.code,
    });
  }
});

module.exports = router;
