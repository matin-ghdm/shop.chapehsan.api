const express = require("express");
const { query } = require("../db");
const { notifyServiceRequest } = require("../services/telegram-bot");
const { parseRequestAttachments } = require("../lib/request-attachments");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const clean = (value, max = 1000) => String(value ?? "").trim().slice(0, max);

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "دسترسی غیرمجاز" });
  next();
}

router.get("/admin/all", authenticate, requireAdmin, async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, service_slug, service_label, customer_name, phone, item_description,
              quantity, details, attachments, status, created_at
       FROM service_requests ORDER BY created_at DESC LIMIT 300`,
    );
    return res.json({ requests: result.rows });
  } catch (error) {
    console.error("Service requests admin list failed:", error.message);
    return res.status(500).json({ message: "دریافت درخواست‌ها ناموفق بود" });
  }
});

router.post("/", async (req, res) => {
  const body = req.body || {};
  if (clean(body.website, 200)) return res.status(201).json({ message: "درخواست ثبت شد" });

  const serviceSlug = clean(body.service_slug, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const serviceLabel = clean(body.service_label, 120);
  const customerName = clean(body.customer_name, 120);
  const phone = clean(body.phone, 30).replace(/[\s-]/g, "");
  const itemDescription = clean(body.item_description, 1200);
  const quantity = Number(body.quantity || 1);
  const details = clean(body.details, 3000);
  const attachments = parseRequestAttachments(body.attachments);

  if (!serviceSlug || !serviceLabel || customerName.length < 2 || !/^\+?\d{10,15}$/.test(phone) || itemDescription.length < 3 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || attachments === null) {
    return res.status(400).json({ message: "لطفاً اطلاعات ضروری درخواست را کامل و درست وارد کنید", code: "VALIDATION_ERROR" });
  }

  try {
    const inserted = await query(
      `INSERT INTO service_requests (service_slug, service_label, customer_name, phone, item_description, quantity, details, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id, created_at`,
      [serviceSlug, serviceLabel, customerName, phone, itemDescription, quantity, details || null, JSON.stringify(attachments)],
    );
    const request = { id: inserted.rows[0].id, service_label: serviceLabel, customer_name: customerName, phone, item_description: itemDescription, quantity, details, attachments };
    await notifyServiceRequest(request);
    return res.status(201).json({ request: inserted.rows[0], message: "درخواست شما ثبت شد" });
  } catch (error) {
    console.error("Service request failed:", error.message);
    return res.status(500).json({ message: "ثبت درخواست ناموفق بود. لطفاً دوباره تلاش کنید" });
  }
});

module.exports = router;
