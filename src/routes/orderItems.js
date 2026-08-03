const express = require("express");
const orderItemsService = require("../services/orderItems");
const ordersService = require("../services/orders");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

router.get("/", async (req, res) => {
  try {
    if (req.query.order_id) {
      const order = await ordersService.findById(req.query.order_id);
      ordersService.assertOrderAccess(order, req.user);
      const items = await orderItemsService.listItems({ orderId: req.query.order_id });
      return res.json({ items });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "برای لیست همه آیتم‌ها نقش ادمین لازم است یا order_id بفرستید",
        code: "FORBIDDEN",
      });
    }

    const items = await orderItemsService.listItems();
    res.json({ items });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت آیتم‌ها",
      code: err.code,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const item = await orderItemsService.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: "آیتم پیدا نشد", code: "NOT_FOUND" });
    }
    const order = await ordersService.findById(item.order_id);
    ordersService.assertOrderAccess(order, req.user);
    res.json({ item });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت آیتم",
      code: err.code,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const item = await orderItemsService.createItem(req.body, req.user);
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در ایجاد آیتم",
      code: err.code,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const item = await orderItemsService.updateItem(req.params.id, req.body, req.user);
    res.json({ item });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در بروزرسانی آیتم",
      code: err.code,
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const item = await orderItemsService.deleteItem(req.params.id, req.user);
    res.json({ message: "آیتم حذف شد", item });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در حذف آیتم",
      code: err.code,
    });
  }
});

module.exports = router;
