const express = require("express");
const { query } = require("../db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const ITEM_PATHS = {
  taslit: "/banner-taslit/",
  stand: "/banner-stand/",
  hamdardi: "/hamdardi/",
  davati: "/kart-davat/",
  hajj: "/hajj/",
  karbala: "/karbala/",
};

function normalizeItem(raw = {}) {
  const itemType = String(raw.itemType || "").trim().toLowerCase();
  const itemKey = String(raw.itemKey || "").trim();
  const title = String(raw.title || "").trim();
  const href = String(raw.href || "").trim();
  const prefix = ITEM_PATHS[itemType];

  if (!prefix || !/^[\p{L}\p{N}._:-]{1,140}$/u.test(itemKey)) {
    return null;
  }
  if (!title || title.length > 180 || href.length > 500) return null;

  try {
    const url = new URL(href, "https://www.chapehsan.com");
    if (
      url.origin !== "https://www.chapehsan.com" ||
      !url.pathname.startsWith(prefix) ||
      url.search ||
      url.hash
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { itemType, itemKey, title, href };
}

router.use(authenticate);

router.get("/", async (req, res) => {
  try {
    const result = await query(
      `SELECT item_type, item_key, title, href, created_at
       FROM user_favorites
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 300`,
      [String(req.user.id)],
    );
    res.json({
      favorites: result.rows.map((row) => ({
        itemType: row.item_type,
        itemKey: row.item_key,
        title: row.title,
        href: row.href,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error("List favorites failed:", err.message);
    res.status(500).json({ message: "دریافت علاقه‌مندی‌ها ناموفق بود" });
  }
});

router.post("/", async (req, res) => {
  const item = normalizeItem(req.body);
  if (!item) {
    return res.status(400).json({ message: "اطلاعات طرح معتبر نیست" });
  }

  try {
    const result = await query(
      `INSERT INTO user_favorites (user_id, item_type, item_key, title, href)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, item_type, item_key)
       DO UPDATE SET title = EXCLUDED.title, href = EXCLUDED.href
       RETURNING item_type, item_key, title, href, created_at`,
      [String(req.user.id), item.itemType, item.itemKey, item.title, item.href],
    );
    const row = result.rows[0];
    res.status(201).json({
      favorite: {
        itemType: row.item_type,
        itemKey: row.item_key,
        title: row.title,
        href: row.href,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    console.error("Save favorite failed:", err.message);
    res.status(500).json({ message: "ذخیرهٔ علاقه‌مندی ناموفق بود" });
  }
});

router.delete("/:itemType/:itemKey", async (req, res) => {
  const itemType = String(req.params.itemType || "").trim().toLowerCase();
  let itemKey;
  try {
    itemKey = decodeURIComponent(req.params.itemKey || "").trim();
  } catch {
    return res.status(400).json({ message: "شناسهٔ طرح معتبر نیست" });
  }

  if (!ITEM_PATHS[itemType] || !/^[\p{L}\p{N}._:-]{1,140}$/u.test(itemKey)) {
    return res.status(400).json({ message: "شناسهٔ طرح معتبر نیست" });
  }

  try {
    await query(
      `DELETE FROM user_favorites
       WHERE user_id = $1 AND item_type = $2 AND item_key = $3`,
      [String(req.user.id), itemType, itemKey],
    );
    res.json({ message: "از علاقه‌مندی‌ها حذف شد" });
  } catch (err) {
    console.error("Delete favorite failed:", err.message);
    res.status(500).json({ message: "حذف علاقه‌مندی ناموفق بود" });
  }
});

module.exports = router;
