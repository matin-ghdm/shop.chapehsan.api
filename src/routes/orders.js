const express = require("express");
const ordersService = require("../services/orders");
const orderItemsService = require("../services/orderItems");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

router.get("/", async (req, res) => {
  try {
    const userId = req.user.role === "admin" ? req.query.user_id || null : req.user.id;
    const orders = await ordersService.listOrders({
      userId,
      status: req.query.status || null,
    });
    res.json({ orders });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت سفارش‌ها",
      code: err.code,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const order = await ordersService.getOrderWithItems(req.params.id);
    ordersService.assertOrderAccess(order, req.user);
    res.json({ order });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت سفارش",
      code: err.code,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const order = await ordersService.createOrder(req.body, req.user);
    res.status(201).json({ order });
  } catch (err) {
    console.error("CREATE order failed:", err.message);
    res.status(err.status || 500).json({
      message: err.message || "خطا در ایجاد سفارش",
      code: err.code,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const existing = await ordersService.findById(req.params.id);
    ordersService.assertOrderAccess(existing, req.user);
    const order = await ordersService.updateOrder(req.params.id, req.body);
    res.json({ order });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در بروزرسانی سفارش",
      code: err.code,
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const existing = await ordersService.findById(req.params.id);
    ordersService.assertOrderAccess(existing, req.user);
    const order = await ordersService.deleteOrder(req.params.id);
    res.json({ message: "سفارش حذف شد", order });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در حذف سفارش",
      code: err.code,
    });
  }
});

router.get("/:id/items", async (req, res) => {
  try {
    const order = await ordersService.findById(req.params.id);
    ordersService.assertOrderAccess(order, req.user);
    const items = await ordersService.getItemsByOrderId(req.params.id);
    res.json({ items });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت آیتم‌ها",
      code: err.code,
    });
  }
});

router.post("/:id/items", async (req, res) => {
  try {
    const item = await orderItemsService.createItem(
      { ...req.body, order_id: req.params.id },
      req.user
    );
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در افزودن آیتم",
      code: err.code,
    });
  }
});

module.exports = router;
