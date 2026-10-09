const express = require("express");
const { query } = require("../db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const ITEM_TYPES = new Set([
  "taslit",
  "stand",
  "hamdardi",
  "davati",
  "hajj",
  "karbala",
]);

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "فقط ادمین مجاز است", code: "FORBIDDEN" });
  }
  next();
}

function normalizeItemType(value) {
  const itemType = String(value || "").trim().toLowerCase();
  return ITEM_TYPES.has(itemType) ? itemType : null;
}

function normalizeItemKey(value) {
  const itemKey = String(value || "").trim();
  return /^[\p{L}\p{N}._:-]{1,140}$/u.test(itemKey) ? itemKey : null;
}

router.get("/", async (req, res) => {
  const itemType = normalizeItemType(req.query.item_type);
  const itemKey = normalizeItemKey(req.query.item_key);
  if (!itemType || !itemKey) {
    return res.status(400).json({ message: "شناسهٔ محصول معتبر نیست" });
  }

  try {
    const [reviews, summary] = await Promise.all([
      query(
        `SELECT r.id, r.item_type, r.item_key, r.item_title, r.rating, r.body,
                r.admin_reply, r.created_at,
                TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lname, ''))) AS author
         FROM product_reviews r
         LEFT JOIN users u ON u.id::text = r.user_id
         WHERE r.item_type = $1 AND r.item_key = $2 AND r.status = 'approved'
         ORDER BY r.created_at DESC
         LIMIT 50`,
        [itemType, itemKey],
      ),
      query(
        `SELECT COUNT(*)::int AS count, COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS average
         FROM product_reviews
         WHERE item_type = $1 AND item_key = $2 AND status = 'approved'`,
        [itemType, itemKey],
      ),
    ]);

    res.set("Cache-Control", "no-store");
    res.json({ reviews: reviews.rows, summary: summary.rows[0] });
  } catch (err) {
    console.error("List product reviews failed:", err.message);
    res.status(500).json({ message: "دریافت دیدگاه‌ها ناموفق بود" });
  }
});

router.post("/", authenticate, async (req, res) => {
  const itemType = normalizeItemType(req.body?.item_type);
  const itemKey = normalizeItemKey(req.body?.item_key);
  const itemTitle = String(req.body?.item_title || "").trim();
  const body = String(req.body?.body || "").trim();
  const rating = Number(req.body?.rating);

  if (!itemType || !itemKey || !itemTitle || itemTitle.length > 180) {
    return res.status(400).json({ message: "اطلاعات محصول معتبر نیست" });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "امتیاز باید بین ۱ تا ۵ باشد" });
  }
  if (body.length < 10 || body.length > 2000) {
    return res.status(400).json({ message: "متن دیدگاه باید بین ۱۰ تا ۲۰۰۰ نویسه باشد" });
  }

  try {
    const result = await query(
      `INSERT INTO product_reviews
         (user_id, item_type, item_key, item_title, rating, body, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (user_id, item_type, item_key) DO UPDATE
         SET item_title = EXCLUDED.item_title,
             rating = EXCLUDED.rating,
             body = EXCLUDED.body,
             status = 'pending',
             admin_reply = NULL,
             updated_at = NOW()
       RETURNING id, item_type, item_key, item_title, rating, body, status, created_at`,
      [String(req.user.id), itemType, itemKey, itemTitle, rating, body],
    );
    res.status(201).json({ review: result.rows[0], message: "دیدگاه برای بررسی ارسال شد" });
  } catch (err) {
    console.error("Save product review failed:", err.message);
    res.status(500).json({ message: "ثبت دیدگاه ناموفق بود" });
  }
});

router.get("/admin", authenticate, requireAdmin, async (req, res) => {
  const allowedStatuses = new Set(["all", "pending", "approved", "rejected"]);
  const status = String(req.query.status || "pending");
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ message: "وضعیت دیدگاه معتبر نیست" });
  }

  try {
    const values = [];
    const where = status === "all" ? "" : "WHERE r.status = $1";
    if (where) values.push(status);
    const result = await query(
      `SELECT r.id, r.user_id, r.item_type, r.item_key, r.item_title, r.rating,
              r.body, r.status, r.admin_reply, r.created_at, r.updated_at,
              TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lname, ''))) AS author,
              u.phone AS author_phone
       FROM product_reviews r
       LEFT JOIN users u ON u.id::text = r.user_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 250`,
      values,
    );
    res.json({ reviews: result.rows });
  } catch (err) {
    console.error("Admin list reviews failed:", err.message);
    res.status(500).json({ message: "دریافت دیدگاه‌ها ناموفق بود" });
  }
});

router.patch("/:id", authenticate, requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const status = String(req.body?.status || "");
  const adminReply = req.body?.admin_reply == null
    ? null
    : String(req.body.admin_reply).trim();

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ message: "شناسهٔ دیدگاه معتبر نیست" });
  }
  if (!new Set(["pending", "approved", "rejected"]).has(status)) {
    return res.status(400).json({ message: "وضعیت دیدگاه معتبر نیست" });
  }
  if (adminReply && adminReply.length > 2000) {
    return res.status(400).json({ message: "پاسخ مدیر بیش از حد طولانی است" });
  }

  try {
    const result = await query(
      `UPDATE product_reviews
       SET status = $2, admin_reply = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, item_type, item_key, item_title, rating, body, status, admin_reply, updated_at`,
      [id, status, adminReply],
    );
    if (!result.rowCount) return res.status(404).json({ message: "دیدگاه پیدا نشد" });
    res.json({ review: result.rows[0] });
  } catch (err) {
    console.error("Update product review failed:", err.message);
    res.status(500).json({ message: "ویرایش دیدگاه ناموفق بود" });
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id || ""))) {
    return res.status(400).json({ message: "شناسهٔ دیدگاه معتبر نیست" });
  }
  try {
    const result = await query("DELETE FROM product_reviews WHERE id = $1", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: "دیدگاه پیدا نشد" });
    res.json({ message: "دیدگاه حذف شد" });
  } catch (err) {
    console.error("Delete product review failed:", err.message);
    res.status(500).json({ message: "حذف دیدگاه ناموفق بود" });
  }
});

module.exports = router;
