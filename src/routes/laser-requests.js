const express = require("express");
const { query } = require("../db");
const { notifyLaserRequest } = require("../services/telegram-bot");
const { parseRequestAttachments } = require("../lib/request-attachments");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../lib/panel-permissions");

const router = express.Router();
const VALID_SERVICES = new Set(["fiber", "co2"]);
const VALID_MATERIAL_OWNERS = new Set(["customer", "business", "unsure"]);

const requireRequestsAccess = requirePermission("requests.manage");

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

router.get("/admin/all", authenticate, requireRequestsAccess, async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, service, customer_name, phone, material, item_description, quantity,
              dimensions, material_provided_by, needed_by, artwork_note, attachments,
              status, created_at
       FROM laser_requests ORDER BY created_at DESC LIMIT 300`,
    );
    return res.json({ requests: result.rows });
  } catch (error) {
    console.error("Laser requests admin list failed:", error.message);
    return res.status(500).json({ message: "دریافت درخواست‌ها ناموفق بود" });
  }
});

router.post("/", async (req, res) => {
  const body = req.body || {};
  // Honeypot field for basic automated spam; successful bot submissions are discarded.
  if (clean(body.website, 200)) return res.status(201).json({ message: "درخواست ثبت شد" });

  const service = clean(body.service, 20);
  const customerName = clean(body.customer_name, 120);
  const phone = clean(body.phone, 30).replace(/[\s-]/g, "");
  const material = clean(body.material, 120);
  const itemDescription = clean(body.item_description, 1500);
  const quantity = Number(body.quantity);
  const dimensions = clean(body.dimensions, 160);
  const materialProvidedBy = clean(body.material_provided_by, 20);
  const neededBy = clean(body.needed_by, 40);
  const artworkNote = clean(body.artwork_note, 1500);
  const attachments = parseRequestAttachments(body.attachments);
  if (attachments === null) return res.status(400).json({ message: "پیوست‌ها معتبر نیستند؛ حداکثر ۳ فایل، تصاویر تا ۳ مگابایت و سایر فایل‌ها تا ۱۵ مگابایت پذیرفته می‌شوند.", code: "INVALID_ATTACHMENTS" });

  if (!VALID_SERVICES.has(service) || customerName.length < 2 || !/^\+?\d{10,15}$/.test(phone) || !material || itemDescription.length < 4 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || !VALID_MATERIAL_OWNERS.has(materialProvidedBy)) {
    return res.status(400).json({ message: "لطفاً اطلاعات ضروری سفارش را کامل و درست وارد کنید", code: "VALIDATION_ERROR" });
  }

  try {
    const inserted = await query(
      `INSERT INTO laser_requests
        (service, customer_name, phone, material, item_description, quantity, dimensions, material_provided_by, needed_by, artwork_note, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       RETURNING id, created_at`,
      [service, customerName, phone, material, itemDescription, quantity, dimensions || null, materialProvidedBy, neededBy || null, artworkNote || null, JSON.stringify(attachments)],
    );
    const request = {
      id: inserted.rows[0].id,
      service,
      customer_name: customerName,
      phone,
      material,
      item_description: itemDescription,
      quantity,
      dimensions,
      material_provided_by: materialProvidedBy,
      needed_by: neededBy,
      artwork_note: artworkNote,
      attachments,
    };
    await notifyLaserRequest(request);
    return res.status(201).json({ request: inserted.rows[0], message: "درخواست سفارش ثبت شد" });
  } catch (error) {
    console.error("Laser order request failed:", error.message);
    return res.status(500).json({ message: "ثبت درخواست ناموفق بود. لطفاً دوباره تلاش کنید" });
  }
});

module.exports = router;
