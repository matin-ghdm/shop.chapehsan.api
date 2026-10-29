const express = require("express");
const { query } = require("../db");
const { notifyServiceRequest } = require("../services/telegram-bot");
const { parseRequestAttachments } = require("../lib/request-attachments");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../lib/panel-permissions");

const router = express.Router();
const clean = (value, max = 1000) => String(value ?? "").trim().slice(0, max);

const requireRequestsAccess = requirePermission("requests.manage");

router.get("/admin/all", authenticate, requireRequestsAccess, async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, service_slug, service_label, customer_name, phone, item_description,
              quantity, details, attachments, product_code, product_title, product_selection, status, created_at
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
  if (attachments === null) return res.status(400).json({ message: "پیوست‌ها معتبر نیستند؛ حداکثر ۳ فایل، تصاویر تا ۳ مگابایت و سایر فایل‌ها تا ۱۵ مگابایت پذیرفته می‌شوند.", code: "INVALID_ATTACHMENTS" });
  const productCode = clean(body.product_code, 80);
  const productType = clean(body.product_type, 40);
  const productSelection = body.product_selection || null;

  if (!serviceSlug || !serviceLabel || customerName.length < 2 || !/^\+?\d{10,15}$/.test(phone) || itemDescription.length < 3 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
    return res.status(400).json({ message: "لطفاً اطلاعات ضروری درخواست را کامل و درست وارد کنید", code: "VALIDATION_ERROR" });
  }

  try {
    let product = null;
    let normalizedSelection = null;
    if (productCode || productSelection) {
      if (!productCode || !productType) return res.status(400).json({ message: "اطلاعات محصول درخواست معتبر نیست", code: "VALIDATION_ERROR" });
      const result = await query("SELECT code, type, title, price, is_active, product_options FROM designs WHERE code = $1 AND type = $2 LIMIT 1", [productCode, productType]);
      product = result.rows[0];
      if (!product || !product.is_active) return res.status(404).json({ message: "این محصول در دسترس نیست" });
      const settings = product.product_options?.order_settings || {};
      if (settings.order_mode !== "request" && settings.pricing_mode !== "quote") return res.status(400).json({ message: "این محصول برای ثبت درخواست تنظیم نشده است", code: "VALIDATION_ERROR" });
      const quote = require("../services/product-options").quoteProduct(product, productSelection, quantity, { allowUnpriced: true, allowRequest: true });
      normalizedSelection = quote.selection;
    }
    const inserted = await query(
      `INSERT INTO service_requests (service_slug, service_label, customer_name, phone, item_description, quantity, details, attachments, product_code, product_title, product_selection)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb) RETURNING id, created_at`,
      [serviceSlug, serviceLabel, customerName, phone, itemDescription, quantity, details || null, JSON.stringify(attachments), product?.code || null, product?.title || null, normalizedSelection ? JSON.stringify(normalizedSelection) : null],
    );
    const selectionLines = normalizedSelection ? [
      ...(normalizedSelection.variant_name ? [`نوع: ${normalizedSelection.variant_name}${normalizedSelection.width_cm && normalizedSelection.height_cm ? `، ${normalizedSelection.width_cm} × ${normalizedSelection.height_cm} سانتی‌متر` : ""}`] : []),
      ...(normalizedSelection.fields || []).map(field => `${field.label}${field.unit ? ` (${field.unit})` : ""}: ${field.value}`),
      ...(normalizedSelection.extras || []).map(extra => `${extra.name}${extra.quantity ? ` × ${extra.quantity}` : ""}`),
    ] : [];
    const notificationDetails = [details, ...selectionLines].filter(Boolean).join("\n");
    const request = { id: inserted.rows[0].id, service_label: product ? `درخواست محصول: ${product.title}` : serviceLabel, customer_name: customerName, phone, item_description: product?.title || itemDescription, quantity, details: notificationDetails, attachments, product_code: product?.code || null, product_selection: normalizedSelection };
    await notifyServiceRequest(request);
    return res.status(201).json({ request: inserted.rows[0], message: "درخواست شما ثبت شد" });
  } catch (error) {
    console.error("Service request failed:", error.message);
    return res.status(500).json({ message: "ثبت درخواست ناموفق بود. لطفاً دوباره تلاش کنید" });
  }
});

module.exports = router;
