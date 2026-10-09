const express = require("express");
const { query } = require("../db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      message: "فقط ادمین مجاز است",
      code: "FORBIDDEN",
    });
  }
  next();
}

router.get("/metrics", authenticate, requireAdmin, async (_req, res) => {
  try {
    const [metrics, favorites] = await Promise.all([
      query(`
        SELECT
          (SELECT COUNT(*)::int FROM users WHERE COALESCE(role, 'user') <> 'admin') AS customers,
          (SELECT COUNT(*)::int FROM designs WHERE is_active = TRUE) AS designs_active,
          (SELECT COUNT(*)::int FROM orders) AS orders_total,
          (SELECT COUNT(*)::int FROM orders
            WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Tehran')
              AT TIME ZONE 'Asia/Tehran') AS orders_today,
          (SELECT COUNT(*)::int FROM orders
            WHERE status IN ('pending', 'awaiting_payment', 'paid')) AS orders_waiting,
          (SELECT COUNT(*)::int FROM orders
            WHERE status IN ('confirmed', 'printing')) AS orders_in_progress,
          (SELECT COUNT(*)::int FROM orders WHERE status = 'ready') AS orders_ready,
          (SELECT COUNT(*)::int FROM user_favorites) AS favorites_total
      `),
      query(`
        SELECT item_type, COUNT(*)::int AS total
        FROM user_favorites
        GROUP BY item_type
        ORDER BY total DESC, item_type ASC
      `),
    ]);

    res.set("Cache-Control", "no-store");
    res.json({ metrics: metrics.rows[0], favoritesByType: favorites.rows });
  } catch (err) {
    console.error("Load admin metrics failed:", err.message);
    res.status(500).json({ message: "دریافت آمار داشبورد ناموفق بود" });
  }
});

module.exports = router;
