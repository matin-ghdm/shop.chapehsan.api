const crypto = require("crypto");
const express = require("express");
const { pool, query } = require("../db");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../lib/panel-permissions");
const qrCode = require("../lib/qr-code");
const { TIERS, DEFAULT_PLANS, planSnapshot, planPrice, publicPlans, validateCardDataShape, validateCardData, publicCardData } = require("../services/digital-card-entitlements");

const router = express.Router();
const templates = new Set(["corporate", "minimal", "luxury", "shop", "medical", "formal-premium"]);
const freeTemplates = new Set(["corporate", "minimal", "formal-premium"]);
const paidTemplates = [{ id: "luxury", label: "لوکس" }, { id: "shop", label: "فروشگاهی" }, { id: "medical", label: "پزشکی و خدماتی" }];
const eventTypes = new Set(["view", "mobile", "phone", "map", "messenger", "social", "website", "email"]);
const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const fail = (res, status, message) => res.status(status).json({ message });
const isSiteAdmin = (user) => String(user?.role || "").trim().toLowerCase() === "admin";
const vcardEscape = (value) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
  .replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
function foldVcardLine(line) {
  const chunks = [];
  let chunk = "";
  let byteLength = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (byteLength + size > 75) {
      chunks.push(chunk);
      chunk = " ";
      byteLength = 1;
    }
    chunk += character;
    byteLength += size;
  }
  chunks.push(chunk);
  return chunks.join("\r\n");
}
function vcardUrl(value) {
  const text = clean(value, 1000);
  if (!text) return "";
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
}

async function getPlanSettings() {
  const result = await query("SELECT key, value FROM digital_card_settings");
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}

async function accountEntitlements(userId, db = query) {
  const [settingsResult, subscriptionResult] = await Promise.all([
    db("SELECT key,value FROM digital_card_settings"),
    db(`SELECT plan_code,entitlements_snapshot,ends_at FROM digital_card_subscriptions
      WHERE user_id=$1 AND starts_at IS NOT NULL AND starts_at<=NOW() AND ends_at>NOW()
      ORDER BY CASE plan_code WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 ELSE 1 END DESC,ends_at DESC,created_at DESC LIMIT 1`, [userId]),
  ]);
  const settings = Object.fromEntries(settingsResult.rows.map((row) => [row.key, row.value]));
  const subscription = subscriptionResult.rows[0];
  const fallback = planSnapshot(settings, subscription?.plan_code || "bronze");
  const saved = subscription?.entitlements_snapshot;
  const plan = saved?.limits && saved?.features
    ? { ...fallback, ...saved, limits: { ...fallback.limits, ...saved.limits }, features: { ...fallback.features, ...saved.features } }
    : fallback;
  return { plan, settings, subscribed: Boolean(subscription), endsAt: subscription?.ends_at || null };
}

function accountAssetUrls(data = {}) {
  const urls = [data.logo, data.portrait, data.cover, data.catalog];
  for (const item of [...(Array.isArray(data.catalogs) ? data.catalogs : []), ...(Array.isArray(data.gallery) ? data.gallery : []), ...(Array.isArray(data.products) ? data.products : [])]) {
    if (item && typeof item === "object") urls.push(item.url, item.image);
  }
  return [...new Set(urls.filter((value) => typeof value === "string" && value.startsWith("https://")))];
}

async function publicCardBySlug(slug) {
  const result = await query(`
    SELECT c.*, COALESCE(s.ends_at, c.trial_ends_at) AS access_ends_at,
      s.plan_code AS access_plan_code,s.entitlements_snapshot AS access_entitlements_snapshot,
      (SELECT role FROM users WHERE id=c.user_id) AS owner_role,
      (SELECT COUNT(*)::int FROM digital_cards ranked WHERE ranked.user_id=c.user_id AND ranked.deleted_at IS NULL
        AND ranked.status IN ('active','trial') AND (ranked.created_at<c.created_at OR (ranked.created_at=c.created_at AND ranked.id<=c.id))) AS active_card_position,
      (SELECT COUNT(*)::int FROM digital_card_events e WHERE e.card_id=c.id AND e.event_type='view') AS views
    FROM digital_cards c
    LEFT JOIN LATERAL (SELECT plan_code,entitlements_snapshot,ends_at FROM digital_card_subscriptions
      WHERE user_id=c.user_id AND starts_at IS NOT NULL AND starts_at<=NOW() AND ends_at>NOW()
      ORDER BY CASE plan_code WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 ELSE 1 END DESC,ends_at DESC,created_at DESC LIMIT 1) s ON TRUE
    WHERE c.public_id=$1 AND c.deleted_at IS NULL LIMIT 1`, [slug]);
  const card = result.rows[0];
  if (!card) return null;
  const accessEndsAt = card.access_ends_at ? new Date(card.access_ends_at) : null;
  const settings = await getPlanSettings();
  const fallback = planSnapshot(settings, card.access_plan_code || "bronze");
  const saved = card.access_entitlements_snapshot;
  card.entitlements = saved?.limits && saved?.features
    ? { ...fallback, ...saved, limits: { ...fallback.limits, ...saved.limits }, features: { ...fallback.features, ...saved.features } }
    : fallback;
  const withinCardLimit = Number(card.active_card_position) <= card.entitlements.limits.activeCards;
  const permitted = card.access_exempt === true || ((card.status === "active" || card.status === "trial") && withinCardLimit && accessEndsAt && accessEndsAt > new Date());
  return permitted ? card : { ...card, status: "expired", data: null };
}

router.get("/plans", async (_req, res) => {
  try {
    const settings = await getPlanSettings();
    res.json({ trialDays: Number(settings.trial_days ?? 7), plans: publicPlans(settings) });
  } catch (error) { res.status(500).json({ message: "دریافت تعرفه‌ها ممکن نشد" }); }
});

router.get("/public/:slug", async (req, res) => {
  try {
    const card = await publicCardBySlug(clean(req.params.slug, 32));
    if (!card) return fail(res, 404, "کارت پیدا نشد");
    if (card.status === "expired") return res.status(410).json({ message: "اعتبار این کارت به پایان رسیده است", expired: true });
    const publicEntitlements = isSiteAdmin({ role: card.owner_role })
      ? { ...card.entitlements, limits: { ...card.entitlements.limits, linksPerCard: Number.MAX_SAFE_INTEGER } }
      : card.entitlements;
    res.json({ card: { public_id: card.public_id, title: card.title, template: card.template, accent_color: card.accent_color, data: publicCardData(card.data, publicEntitlements), views: card.views, access_ends_at: card.access_ends_at, entitlements: card.entitlements } });
  } catch (error) { console.error("Public digital card failed:", error.message); res.status(500).json({ message: "نمایش کارت ممکن نشد" }); }
});

router.get("/public/:slug/qr.svg", async (req, res) => {
  try {
    const card = await query("SELECT public_id FROM digital_cards WHERE public_id=$1 AND deleted_at IS NULL", [clean(req.params.slug, 32)]);
    if (!card.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const base = String(process.env.DIGITAL_CARD_PUBLIC_BASE_URL || "https://www.chapehsan.com").replace(/\/$/, "");
    const link = `${base}/c/${encodeURIComponent(card.rows[0].public_id)}`;
    const size = Number(req.query.size) || 512;
    const svg = qrCode.toSvg(qrCode.makeQrMatrix(link), { color: req.query.color, size, transparent: req.query.transparent === "true" });
    res.set({ "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": `attachment; filename="${card.rows[0].public_id}.svg"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).send(svg);
  } catch (error) { res.status(error.status || 500).json({ message: error.message || "ساخت QR ممکن نشد" }); }
});

router.get("/public/:slug/qr.png", async (req, res) => {
  try {
    const card = await query("SELECT public_id FROM digital_cards WHERE public_id=$1 AND deleted_at IS NULL", [clean(req.params.slug, 32)]);
    if (!card.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const base = String(process.env.DIGITAL_CARD_PUBLIC_BASE_URL || "https://www.chapehsan.com").replace(/\/$/, "");
    const link = `${base}/c/${encodeURIComponent(card.rows[0].public_id)}`;
    const png = qrCode.toPng(qrCode.makeQrMatrix(link), { color: req.query.color, size: req.query.size, transparent: req.query.transparent === "true" });
    res.set({ "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${card.rows[0].public_id}.png"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).send(png);
  } catch (error) { res.status(error.status || 500).json({ message: error.message || "ساخت QR ممکن نشد" }); }
});

router.post("/public/:slug/events", async (req, res) => {
  const type = clean(req.body?.type, 20);
  if (!eventTypes.has(type)) return fail(res, 400, "نوع رویداد معتبر نیست");
  try {
    const card = await publicCardBySlug(clean(req.params.slug, 32));
    if (!card || card.status === "expired") return fail(res, 410, "کارت فعال نیست");
    await query("INSERT INTO digital_card_events(card_id,event_type) VALUES($1,$2)", [card.id, type]);
    res.status(204).end();
  } catch (error) { res.status(500).json({ message: "ثبت رویداد ممکن نشد" }); }
});

router.get("/public/:slug/vcf", async (req, res) => {
  try {
    const card = await publicCardBySlug(clean(req.params.slug, 32));
    if (!card || card.status === "expired") return fail(res, 410, "کارت فعال نیست");
    const d = card.data || {};
    const phones = Array.isArray(d.phones) ? d.phones.filter((x) => x?.value && x.visible !== false) : [];
    const firstName = clean(d.firstName, 120);
    const lastName = clean(d.lastName, 120);
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN;CHARSET=UTF-8:${vcardEscape([firstName, lastName].filter(Boolean).join(" ") || card.title)}`, `N;CHARSET=UTF-8:${vcardEscape(lastName)};${vcardEscape(firstName)};;;`];
    if (d.company) lines.push(`ORG;CHARSET=UTF-8:${vcardEscape(d.company)}`);
    if (d.job) lines.push(`TITLE;CHARSET=UTF-8:${vcardEscape(d.job)}`);
    for (const p of phones) lines.push(`TEL;TYPE=${p.kind === "fax" ? "WORK,FAX" : p.kind === "landline" ? "WORK,VOICE" : "CELL"}:${vcardEscape(p.value)}`);
    if (d.fax) lines.push(`TEL;TYPE=WORK,FAX:${vcardEscape(d.fax)}`);
    if (d.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${vcardEscape(d.email)}`);

    const addresses = Array.isArray(d.addresses) ? d.addresses.filter((x) => x?.value && x.visible !== false) : d.address ? [{ label: "نشانی", value: d.address, postalCode: d.postalCode, map: d.map }] : [];
    const notes = phones.filter((phone) => phone.label).map((phone) => `شماره ${clean(phone.label, 80)}: ${clean(phone.value, 80)}`);
    for (const address of addresses) {
      lines.push(`ADR;TYPE=WORK;CHARSET=UTF-8:;;${vcardEscape(address.value)};;;${vcardEscape(address.postalCode || "")};`);
      notes.push(`${clean(address.label || "نشانی", 80)}: ${address.value}${address.postalCode ? ` · کدپستی: ${address.postalCode}` : ""}`);
    }
    if (d.bio) notes.push(`معرفی: ${clean(d.bio, 1000)}`);
    const hoursSchedule = Array.isArray(d.hoursSchedule) ? d.hoursSchedule.filter((day) => day?.enabled && day.day && day.open && day.close) : [];
    const formattedHours = hoursSchedule.map((day) => `${clean(day.day, 20)}: ${clean(day.open, 5)} تا ${clean(day.close, 5)}`).join(" · ");
    if (formattedHours || d.hours) notes.push(`ساعات کاری: ${formattedHours || clean(d.hours, 300)}`);

    const urls = new Set();
    const addUrl = (value) => { const url = vcardUrl(value); if (url && urls.size < 40) urls.add(url); return url; };
    for (const [label, value] of [["وب‌سایت", d.website], ["فروشگاه", d.shopLink], ["پیوند پرداخت", d.paymentLink], ["کاتالوگ", d.catalog]]) {
      const url = addUrl(value);
      if (url) notes.push(`${label}: ${url}`);
    }
    for (const address of addresses) {
      const map = addUrl(address.map);
      if (map) notes.push(`نقشه ${clean(address.label || "نشانی", 80)}: ${map}`);
    }
    const socialHosts = { telegram: "https://t.me/", instagram: "https://instagram.com/", eitaa: "https://eitaa.com/", rubika: "https://rubika.ir/", bale: "https://ble.ir/", linkedin: "https://linkedin.com/in/", aparat: "https://aparat.com/" };
    const socials = Array.isArray(d.socialLinks) ? d.socialLinks.filter((x) => x?.value && x.visible !== false) : ["whatsapp", "telegram", "instagram", "eitaa", "rubika", "bale", "linkedin", "aparat"].filter((platform) => d[platform]).map((platform) => ({ platform, label: platform, value: d[platform] }));
    for (const social of socials) {
      const value = clean(social.value, 500);
      const handle = value.replace(/^@/, "");
      const digits = value.replace(/[۰-۹٠-٩]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(digit) % 10));
      const socialUrl = /^https?:\/\//i.test(value) ? value : social.platform === "whatsapp" ? `https://wa.me/${digits.replace(/\D/g, "")}` : social.platform === "custom" ? value : socialHosts[social.platform] ? `${socialHosts[social.platform]}${encodeURIComponent(handle)}` : "";
      const url = addUrl(socialUrl);
      notes.push(`${clean(social.label || social.platform, 80)}: ${url || value}`);
    }
    for (const item of [...(Array.isArray(d.customLinks) ? d.customLinks : []), ...(Array.isArray(d.portfolio) ? d.portfolio : [])]) {
      if (!item?.url || item.visible === false) continue;
      const url = addUrl(item.url);
      notes.push(`${clean(item.label || "پیوند", 80)}: ${url || clean(item.url, 500)}`);
    }
    for (const url of urls) lines.push(`URL:${vcardEscape(url)}`);
    if (notes.length) lines.push(`NOTE;CHARSET=UTF-8:${vcardEscape(notes.join("\n")).slice(0, 8000)}`);
    const portrait = vcardUrl(d.portrait);
    const logo = vcardUrl(d.logo);
    if (portrait || logo) lines.push(`PHOTO;VALUE=URL:${vcardEscape(portrait || logo)}`);
    if (logo && logo !== portrait) lines.push(`LOGO;VALUE=URL:${vcardEscape(logo)}`);
    lines.push("END:VCARD");
    await query("INSERT INTO digital_card_events(card_id,event_type) VALUES($1,'vcf')", [card.id]);
    res.set({ "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="${card.public_id}.vcf"`, "X-Content-Type-Options": "nosniff" }).send(lines.map(foldVcardLine).join("\r\n"));
  } catch (error) { res.status(500).json({ message: "ساخت مخاطب ممکن نشد" }); }
});

router.post("/public/:slug/leads", async (req, res) => {
  const name = clean(req.body?.name, 120);
  const phone = clean(req.body?.phone, 32);
  const email = clean(req.body?.email, 254);
  const message = clean(req.body?.message, 2000);
  if (req.body?.website) return res.status(204).end();
  const phoneDigits = phone.replace(/[۰-۹٠-٩]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(digit) % 10)).replace(/\D/g, "");
  if (name.length < 2 || phoneDigits.length < 7 || phoneDigits.length > 15 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return fail(res, 400, "نام، شماره تماس یا ایمیل معتبر نیست");
  }
  try {
    const card = await publicCardBySlug(clean(req.params.slug, 32));
    if (!card || card.status === "expired") return fail(res, 410, "کارت فعال نیست");
    if (!card.entitlements.features.leadForms || card.data?.leadFormEnabled !== true) return fail(res, 404, "فرم درخواست برای این کارت فعال نیست");
    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const secret = process.env.DIGITAL_CARD_LEAD_HASH_SECRET || process.env.JWT_SECRET || "digital-card-lead-rate-limit";
    const ipHash = crypto.createHmac("sha256", secret).update(ip).digest("hex");
    const limits = await query(`SELECT
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '10 minutes')::int AS recent,
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '1 day')::int AS daily
      FROM digital_card_leads WHERE card_id=$1`, [card.id]);
    if (limits.rows[0].recent >= 60 || limits.rows[0].daily >= 500) return fail(res, 429, "تعداد درخواست‌های این کارت در حال حاضر زیاد است؛ کمی بعد دوباره تلاش کنید");
    await query(`INSERT INTO digital_card_leads(card_id,user_id,name,phone,email,message,ip_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [card.id, card.user_id, name, phone, email || null, message, ipHash]);
    res.status(201).json({ submitted: true, message: "درخواست شما برای صاحب کارت فرستاده شد." });
  } catch (error) {
    console.error("Digital card lead submission failed:", error.message);
    res.status(500).json({ message: "ثبت درخواست انجام نشد" });
  }
});

router.use(authenticate);

router.get("/leads/mine", async (req, res) => {
  try {
    const status = ["new", "read", "archived"].includes(clean(req.query.status, 20)) ? clean(req.query.status, 20) : null;
    const result = await query(`SELECT l.id,l.card_id,l.name,l.phone,l.email,l.message,l.status,l.created_at,c.public_id,c.title
      FROM digital_card_leads l JOIN digital_cards c ON c.id=l.card_id
      WHERE l.user_id=$1 AND ($2::text IS NULL OR l.status=$2)
      ORDER BY l.created_at DESC LIMIT 200`, [req.user.id, status]);
    res.json({ leads: result.rows });
  } catch (error) { res.status(500).json({ message: "درخواست‌های مشتریان در دسترس نیست" }); }
});

router.patch("/leads/:id", async (req, res) => {
  const status = clean(req.body?.status, 20);
  if (!["new", "read", "archived"].includes(status)) return fail(res, 400, "وضعیت درخواست معتبر نیست");
  try {
    const result = await query(`UPDATE digital_card_leads SET status=$1 WHERE id=$2 AND user_id=$3
      RETURNING id,status`, [status, req.params.id, req.user.id]);
    if (!result.rowCount) return fail(res, 404, "درخواست پیدا نشد");
    res.json({ lead: result.rows[0] });
  } catch (error) { res.status(500).json({ message: "به‌روزرسانی درخواست ممکن نشد" }); }
});

router.get("/templates", async (req, res) => {
  try {
    const settings = await getPlanSettings();
    const owned = await query(`SELECT template FROM digital_card_template_purchases WHERE user_id=$1 AND paid_at IS NOT NULL
      UNION SELECT template FROM digital_cards WHERE user_id=$1 AND template IN ('luxury','shop','medical')`, [req.user.id]);
    const ownedTemplates = new Set(owned.rows.map((row) => row.template));
    res.json({ templates: [
      { id: "corporate", label: "رسمی و شرکتی", free: true, active: true, owned: true, price: 0 },
      { id: "minimal", label: "مینیمال", free: true, active: true, owned: true, price: 0 },
      { id: "formal-premium", label: "رسمی و ممتاز", free: true, active: true, owned: true, price: 0 },
      ...paidTemplates.map(({ id, label }) => ({ id, label, free: false, active: settings[`template_${id}_active`] === true && Number(settings[`template_${id}_price`]) >= 100, owned: isSiteAdmin(req.user) || ownedTemplates.has(id), price: Number(settings[`template_${id}_price`] || 0) })),
    ] });
  } catch (error) { res.status(500).json({ message: "دریافت قالب‌ها ممکن نشد" }); }
});

router.post("/templates/purchase", async (req, res) => {
  const template = clean(req.body?.template, 30);
  const product = paidTemplates.find((item) => item.id === template);
  if (!product) return fail(res, 400, "این قالب قابل خرید نیست");
  if (isSiteAdmin(req.user)) return res.json({ owned: true });
  let client;
  try {
    const settings = await getPlanSettings();
    const amount = Number(settings[`template_${template}_price`]);
    if (settings[`template_${template}_active`] !== true || !Number.isSafeInteger(amount) || amount < 100) return fail(res, 503, "فروش این قالب در حال حاضر فعال نیست");
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [req.user.id]);
    const entitlement = await client.query(`SELECT 1 FROM digital_card_template_purchases WHERE user_id=$1 AND template=$2 AND paid_at IS NOT NULL
      UNION SELECT 1 FROM digital_cards WHERE user_id=$1 AND template=$2 LIMIT 1`, [req.user.id, template]);
    if (entitlement.rowCount) { await client.query("COMMIT"); return res.json({ owned: true }); }
    const pending = await client.query(`SELECT p.order_id,o.total_price FROM digital_card_template_purchases p JOIN orders o ON o.id=p.order_id
      WHERE p.user_id=$1 AND p.template=$2 AND p.paid_at IS NULL AND o.status IN ('awaiting_payment','pending')
      ORDER BY p.created_at DESC LIMIT 1 FOR UPDATE OF p,o`, [req.user.id, template]);
    if (pending.rowCount && Number(pending.rows[0].total_price) === amount) {
      await client.query("COMMIT");
      return res.json({ orderId: pending.rows[0].order_id, amount });
    }
    if (pending.rowCount) await client.query("UPDATE orders SET status='canceled' WHERE id=$1", [pending.rows[0].order_id]);
    const order = await client.query(`INSERT INTO orders(user_id,is_pickup,status,total_price,note)
      VALUES($1,TRUE,'awaiting_payment',$2,$3) RETURNING id`, [req.user.id, amount, `خرید قالب ${product.label} کارت دیجیتال`]);
    await client.query(`INSERT INTO digital_card_template_purchases(user_id,template,amount,order_id) VALUES($1,$2,$3,$4)`, [req.user.id, template, amount, order.rows[0].id]);
    await client.query("COMMIT");
    return res.status(201).json({ orderId: order.rows[0].id, amount });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error("Create digital card template purchase failed:", error.message);
    return res.status(500).json({ message: "ایجاد سفارش خرید قالب ممکن نشد" });
  } finally { client?.release(); }
});

router.get("/mine", async (req, res) => {
  try {
    const account = await accountEntitlements(req.user.id);
    const result = await query(`SELECT c.*,
      COALESCE((SELECT MAX(ends_at) FROM digital_card_subscriptions WHERE user_id=c.user_id AND starts_at IS NOT NULL), c.trial_ends_at) AS access_ends_at,
      (SELECT COUNT(*)::int FROM digital_cards ranked WHERE ranked.user_id=c.user_id AND ranked.deleted_at IS NULL
        AND ranked.status IN ('active','trial') AND (ranked.created_at<c.created_at OR (ranked.created_at=c.created_at AND ranked.id<=c.id))) AS active_card_position,
      (SELECT COUNT(*)::int FROM digital_cards live WHERE live.user_id=c.user_id AND live.deleted_at IS NULL AND live.status IN ('active','trial')) AS live_card_count,
      EXISTS(SELECT 1 FROM digital_cards prior WHERE prior.user_id=c.user_id AND prior.trial_started_at IS NOT NULL AND prior.id<>c.id) AS prior_trial_used,
      (SELECT COUNT(*)::int FROM digital_card_events WHERE card_id=c.id AND event_type='view') AS views
      FROM digital_cards c WHERE c.user_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at DESC`, [req.user.id]);
    const assets = await query(`SELECT COALESCE(SUM(size_bytes),0)::bigint AS used_bytes,
        COALESCE(jsonb_agg(blob_url), '[]'::jsonb) AS urls FROM digital_card_assets WHERE user_id=$1`, [req.user.id]);
    const cards = result.rows.map((card) => {
      const overPlanLimit = ["active", "trial"].includes(card.status) && Number(card.active_card_position) > account.plan.limits.activeCards;
      const draftReason = card.status !== "draft" ? null
        : account.subscribed && Number(card.live_card_count) >= account.plan.limits.activeCards ? "plan_limit"
          : !account.subscribed && card.prior_trial_used ? "trial_used" : "activation_required";
      return { ...card, over_plan_limit: overPlanLimit, draft_reason: draftReason };
    });
    res.json({ cards, entitlements: account.plan, subscriptionEndsAt: account.endsAt, storageUsedBytes: Number(assets.rows[0].used_bytes || 0), registeredAssetUrls: assets.rows[0].urls });
  } catch (error) { res.status(500).json({ message: "دریافت کارت‌ها ممکن نشد" }); }
});

router.post("/:id/assets/register", async (req, res) => {
  const urlText = clean(req.body?.url, 2048);
  const kind = clean(req.body?.kind, 20);
  if (!["logo", "portrait", "cover", "gallery", "product", "catalog"].includes(kind)) return fail(res, 400, "نوع فایل معتبر نیست");
  let blobUrl;
  try {
    blobUrl = new URL(urlText);
    const hostname = blobUrl.hostname.toLowerCase();
    const path = decodeURIComponent(blobUrl.pathname);
    if (blobUrl.protocol !== "https:" || !hostname.endsWith(".public.blob.vercel-storage.com") || blobUrl.username || blobUrl.password || !path.includes(`/digital-cards/${req.params.id}/`)) {
      return fail(res, 400, "پیوند فایل کارت معتبر نیست");
    }
  } catch { return fail(res, 400, "پیوند فایل کارت معتبر نیست"); }

  const assetUrl = blobUrl.toString();
  let fileSize;
  let contentType;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(assetUrl, { method: "HEAD", redirect: "error", signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return fail(res, 400, "اطلاعات فایل بارگذاری‌شده قابل بررسی نیست");
    fileSize = Number(response.headers.get("content-length"));
    contentType = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  } catch { return fail(res, 400, "بررسی فایل بارگذاری‌شده انجام نشد"); }
  const imageType = ["image/jpeg", "image/png", "image/webp"].includes(contentType);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > 20 * 1024 * 1024 || (kind === "catalog" ? contentType !== "application/pdf" : !imageType)) {
    return fail(res, 400, "نوع یا اندازه فایل پذیرفته نیست");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [req.user.id]);
    const card = await client.query("SELECT id,data FROM digital_cards WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [req.params.id, req.user.id]);
    if (!card.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "کارت پیدا نشد"); }
    const account = await accountEntitlements(req.user.id, client.query.bind(client));
    const featureCap = kind === "catalog" ? account.plan.limits.catalogsPerCard
      : kind === "gallery" ? account.plan.limits.galleryImagesPerCard
        : kind === "product" ? account.plan.limits.productsPerCard : 1;
    const linkedExisting = accountAssetUrls(card.rows[0].data || {}).includes(assetUrl);
    if (!linkedExisting && featureCap < 1) { await client.query("ROLLBACK"); return fail(res, 403, "بارگذاری این نوع فایل در پلن فعلی فعال نیست"); }
    const already = await client.query("SELECT id,card_id,user_id,size_bytes FROM digital_card_assets WHERE blob_url=$1", [assetUrl]);
    if (already.rowCount) {
      if (already.rows[0].user_id !== req.user.id || already.rows[0].card_id !== req.params.id) { await client.query("ROLLBACK"); return fail(res, 409, "این فایل به کارت دیگری متصل است"); }
      await client.query("COMMIT");
      return res.json({ asset: { url: assetUrl, sizeBytes: Number(already.rows[0].size_bytes), contentType }, reused: true });
    }
    if (!linkedExisting && ["catalog", "gallery", "product"].includes(kind)) {
      const data = card.rows[0].data || {};
      let dataCount = 0;
      if (kind === "catalog") dataCount = Array.isArray(data.catalogs) ? data.catalogs.length : Number(Boolean(data.catalog));
      else if (kind === "gallery") dataCount = Array.isArray(data.gallery) ? data.gallery.length : 0;
      else dataCount = Array.isArray(data.products) ? data.products.filter((item) => item?.image).length : 0;
      const registeredCount = await client.query("SELECT COUNT(*)::int AS count FROM digital_card_assets WHERE card_id=$1 AND asset_kind=$2", [req.params.id, kind]);
      if (Math.max(dataCount, Number(registeredCount.rows[0].count)) >= featureCap) {
        await client.query("ROLLBACK");
        return fail(res, 403, "سقف فایل‌های این بخش در پلن شما پر شده است");
      }
    }
    const usedResult = await client.query("SELECT COALESCE(SUM(size_bytes),0)::bigint AS used_bytes FROM digital_card_assets WHERE user_id=$1", [req.user.id]);
    const usedBytes = Number(usedResult.rows[0].used_bytes || 0);
    const storageCap = account.plan.limits.storageMb * 1024 * 1024;
    if (!isSiteAdmin(req.user) && usedBytes + fileSize > storageCap) {
      await client.query("ROLLBACK");
      return fail(res, 413, "فضای ذخیره‌سازی پلن شما کافی نیست؛ ارتقای پلن لازم است");
    }
    await client.query(`INSERT INTO digital_card_assets(card_id,user_id,blob_url,size_bytes,content_type,asset_kind)
      VALUES($1,$2,$3,$4,$5,$6)`, [req.params.id, req.user.id, assetUrl, fileSize, contentType, kind]);
    await client.query("COMMIT");
    res.status(201).json({ asset: { url: assetUrl, sizeBytes: fileSize, contentType, kind }, usedBytes: usedBytes + fileSize, storageLimitBytes: storageCap });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register digital card asset failed:", error.message);
    res.status(500).json({ message: "ثبت فایل در فضای حساب انجام نشد" });
  } finally { client.release(); }
});

router.post("/", async (req, res) => {
  const title = clean(req.body?.title || "کارت جدید", 120);
  const template = clean(req.body?.template || "corporate", 30);
  const isAdmin = isSiteAdmin(req.user);
  if (!templates.has(template)) return fail(res, 400, "قالب کارت معتبر نیست");
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [req.user.id]);
      const account = await accountEntitlements(req.user.id, client.query.bind(client));
      const count = await client.query("SELECT COUNT(*)::int AS count FROM digital_cards WHERE user_id=$1 AND status IN ('active','trial') AND deleted_at IS NULL", [req.user.id]);
      if (!isAdmin && !freeTemplates.has(template)) {
        if (account.plan.features.allTemplates) {
          // The account subscription includes every template.
        } else {
        const access = await client.query(`SELECT 1 FROM digital_card_template_purchases WHERE user_id=$1 AND template=$2 AND paid_at IS NOT NULL
          UNION SELECT 1 FROM digital_cards WHERE user_id=$1 AND template=$2 LIMIT 1`, [req.user.id, template]);
        if (!access.rowCount) { await client.query("ROLLBACK"); return fail(res, 403, "برای استفاده از این قالب ابتدا آن را خریداری کنید"); }
        }
      }
      const trial = isAdmin || account.subscribed ? { rowCount: 1 } : await client.query("SELECT id FROM digital_cards WHERE user_id=$1 AND trial_started_at IS NOT NULL LIMIT 1", [req.user.id]);
      const trialDays = Math.max(1, Math.min(30, Number(account.settings.trial_days ?? 7)));
      const canPublishUnderPlan = Number(count.rows[0].count) < account.plan.limits.activeCards;
      const cardStatus = isAdmin || (account.subscribed && canPublishUnderPlan) ? "active" : !account.subscribed && !trial.rowCount ? "trial" : "draft";
      const draftReason = cardStatus !== "draft" ? null
        : account.subscribed && !canPublishUnderPlan ? "plan_limit"
          : !account.subscribed && trial.rowCount ? "trial_used" : "activation_required";
      const result = await client.query(`INSERT INTO digital_cards(user_id,public_id,title,template,data,status,trial_started_at,trial_ends_at,access_exempt)
        VALUES($1,$2,$3,$4,'{}'::jsonb,$5,CASE WHEN $6 OR $7 OR NOT $9 THEN NULL ELSE NOW() END,CASE WHEN $6 OR $7 OR NOT $9 THEN NULL ELSE NOW()+($8::text||' days')::interval END,$6) RETURNING *`,
        [req.user.id, crypto.randomBytes(8).toString("base64url"), title, template, cardStatus, isAdmin, account.subscribed || isAdmin, trialDays, cardStatus === "trial"]);
      await client.query("COMMIT");
      if (result.rows[0].trial_started_at) {
        try { await require("../services/digital-card-notifications").enqueueNotification(result.rows[0].id, "trial_started"); }
        catch (error) { console.error("Could not queue trial-start SMS:", error.message); }
      }
      return res.status(201).json({ card: { ...result.rows[0], draft_reason: draftReason } });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } catch (error) { console.error("Create digital card failed:", error.message); res.status(500).json({ message: "ساخت کارت ممکن نشد" }); }
});

router.post("/:id/activate", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [req.user.id]);
    const card = await client.query("SELECT id,status FROM digital_cards WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [req.params.id, req.user.id]);
    if (!card.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "کارت پیدا نشد"); }
    const account = await accountEntitlements(req.user.id, client.query.bind(client));
    if (!isSiteAdmin(req.user) && !account.subscribed) { await client.query("ROLLBACK"); return fail(res, 402, "برای انتشار کارت، پلن فعال تهیه کنید"); }
    const active = await client.query("SELECT COUNT(*)::int AS count FROM digital_cards WHERE user_id=$1 AND status IN ('active','trial') AND deleted_at IS NULL", [req.user.id]);
    if (!isSiteAdmin(req.user) && Number(active.rows[0].count) >= account.plan.limits.activeCards && card.rows[0].status !== "active") {
      await client.query("ROLLBACK");
      return fail(res, 409, `سقف کارت‌های منتشرشده در پلن ${account.plan.label} پر شده است`);
    }
    const updated = await client.query("UPDATE digital_cards SET status='active',updated_at=NOW() WHERE id=$1 RETURNING id,status", [req.params.id]);
    await client.query("COMMIT");
    res.json({ card: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: "انتشار کارت انجام نشد" });
  } finally { client.release(); }
});

router.put("/:id", async (req, res) => {
  const data = req.body?.data;
  const template = clean(req.body?.template, 30);
  const color = clean(req.body?.accent_color, 7);
  if (!data || typeof data !== "object" || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > 100_000) return fail(res, 400, "اطلاعات کارت معتبر نیست");
  const shapeErrors = validateCardDataShape(data);
  if (shapeErrors.length) return res.status(400).json({ message: "ساختار اطلاعات کارت معتبر نیست", fields: shapeErrors });
  if (!templates.has(template) || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, "ظاهر کارت معتبر نیست");
  const title = clean([data.firstName, data.lastName].filter(Boolean).join(" ") || req.body?.title || "کارت دیجیتال", 120);
  try {
    const owned = await query("SELECT id,data FROM digital_cards WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [req.params.id, req.user.id]);
    if (!owned.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const account = await accountEntitlements(req.user.id);
    if (!isSiteAdmin(req.user)) {
      const quotaErrors = validateCardData(data, owned.rows[0].data || {}, account.plan);
      if (quotaErrors.length) return res.status(403).json({ message: "این تغییر از سقف پلن شما بیشتر است", limits: quotaErrors });
    }
    if (!isSiteAdmin(req.user) && !freeTemplates.has(template)) {
      if (account.plan.features.allTemplates) {
        // The account subscription includes every template.
      } else {
      const access = await query(`SELECT 1 FROM digital_card_template_purchases WHERE user_id=$1 AND template=$2 AND paid_at IS NOT NULL
        UNION SELECT 1 FROM digital_cards WHERE user_id=$1 AND template=$2 LIMIT 1`, [req.user.id, template]);
      if (!access.rowCount) return fail(res, 403, "برای استفاده از این قالب ابتدا آن را خریداری کنید");
      }
    }
    const oldUrls = new Set(accountAssetUrls(owned.rows[0].data || {}));
    const newUrls = accountAssetUrls(data).filter((url) => !oldUrls.has(url));
    if (newUrls.length) {
      const registered = await query(`SELECT blob_url FROM digital_card_assets WHERE user_id=$1 AND card_id=$2 AND blob_url=ANY($3::text[])`, [req.user.id, req.params.id, newUrls]);
      if (registered.rowCount !== newUrls.length) return fail(res, 400, "ابتدا فایل را از مسیر بارگذاری کارت بارگذاری کنید");
    }
    const result = await query(`UPDATE digital_cards SET data=$1::jsonb,template=$2,accent_color=$3,title=$4,updated_at=NOW()
      WHERE id=$5 AND user_id=$6 AND deleted_at IS NULL RETURNING *`, [JSON.stringify(data), template, color, title, req.params.id, req.user.id]);
    if (!result.rowCount) return fail(res, 404, "کارت پیدا نشد");
    res.json({ card: result.rows[0] });
  } catch (error) { res.status(500).json({ message: "ذخیره کارت ممکن نشد" }); }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await query(`UPDATE digital_cards SET deleted_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING id`, [req.params.id, req.user.id]);
    if (!result.rowCount) return fail(res, 404, "کارت پیدا نشد یا قبلاً حذف شده است");
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (error) {
    console.error("Delete digital card failed:", error.message);
    res.status(500).json({ message: "حذف کارت ممکن نشد" });
  }
});

router.get("/:id/stats", async (req, res) => {
  try {
    const owned = await query("SELECT id FROM digital_cards WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [req.params.id, req.user.id]);
    if (!owned.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const account = await accountEntitlements(req.user.id);
    if (!account.plan.features.fullAnalytics) {
      const result = await query(`SELECT 'view' AS event_type,COUNT(*)::int AS count FROM digital_card_events WHERE card_id=$1 AND event_type='view'`, [req.params.id]);
      return res.json({ events: result.rows, daily: [], monthly: [], detailedAvailable: false });
    }
    const [totals, daily, monthly] = await Promise.all([
      query(`SELECT event_type, COUNT(*)::int AS count FROM digital_card_events WHERE card_id=$1 GROUP BY event_type ORDER BY event_type`, [req.params.id]),
      query(`SELECT date_trunc('day',created_at)::date AS date,event_type,COUNT(*)::int AS count
        FROM digital_card_events WHERE card_id=$1 AND created_at>=NOW()-INTERVAL '30 days'
        GROUP BY date_trunc('day',created_at)::date,event_type ORDER BY date DESC,event_type`, [req.params.id]),
      query(`SELECT date_trunc('month',created_at)::date AS month,event_type,COUNT(*)::int AS count
        FROM digital_card_events WHERE card_id=$1 AND created_at>=NOW()-INTERVAL '12 months'
        GROUP BY date_trunc('month',created_at)::date,event_type ORDER BY month DESC,event_type`, [req.params.id]),
    ]);
    res.json({ events: totals.rows, daily: daily.rows, monthly: monthly.rows, detailedAvailable: true });
  } catch (error) { res.status(500).json({ message: "گزارش کارت در دسترس نیست" }); }
});

router.get("/:id/subscriptions", async (req, res) => {
  try {
    const owned = await query("SELECT id FROM digital_cards WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [req.params.id, req.user.id]);
    if (!owned.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const result = await query(`SELECT s.id,s.plan_months,s.amount,s.starts_at,s.ends_at,s.created_at,o.id AS order_id,o.status AS order_status,o.payment_ref_number
      FROM digital_card_subscriptions s LEFT JOIN orders o ON o.id=s.order_id WHERE s.card_id=$1 ORDER BY s.created_at DESC`, [req.params.id]);
    res.json({ subscriptions: result.rows });
  } catch (error) { res.status(500).json({ message: "سوابق اشتراک در دسترس نیست" }); }
});

router.post("/subscriptions", async (req, res) => {
  const cardId = clean(req.body?.cardId, 50);
  const months = Number(req.body?.months);
  const tier = clean(req.body?.tier || req.body?.planCode || "bronze", 20);
  if (!cardId || ![6, 12].includes(months) || !TIERS.includes(tier)) return fail(res, 400, "کارت یا پلن اشتراک معتبر نیست");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query("SELECT id,public_id FROM digital_cards WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [cardId, req.user.id]);
    if (!owned.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "کارت پیدا نشد"); }
    if (isSiteAdmin(req.user)) {
      await client.query("UPDATE digital_cards SET access_exempt=TRUE,status='active',updated_at=NOW() WHERE id=$1", [cardId]);
      await client.query("COMMIT");
      return res.json({ free: true, cardId, status: "active" });
    }
    const settings = await getPlanSettings();
    const price = planPrice(settings, tier, months);
    const amount = price.price;
    if (!Number.isSafeInteger(amount) || amount < 100 || !price.active) { await client.query("ROLLBACK"); return fail(res, 503, "این پلن در حال حاضر برای خرید فعال نیست"); }
    const pending = await client.query(`SELECT s.order_id,o.total_price FROM digital_card_subscriptions s JOIN orders o ON o.id=s.order_id
      WHERE s.user_id=$1 AND s.card_id=$2 AND s.plan_code=$3 AND s.plan_months=$4 AND s.starts_at IS NULL
      AND o.status IN ('awaiting_payment','pending') ORDER BY s.created_at DESC LIMIT 1 FOR UPDATE OF s,o`, [req.user.id, cardId, tier, months]);
    if (pending.rowCount && Number(pending.rows[0].total_price) === amount) {
      await client.query("COMMIT");
      return res.json({ orderId: pending.rows[0].order_id, amount, planCode: tier, months });
    }
    if (pending.rowCount) await client.query("UPDATE orders SET status='canceled' WHERE id=$1", [pending.rows[0].order_id]);
    const orderResult = await client.query(`INSERT INTO orders(user_id,is_pickup,status,total_price,note)
      VALUES($1,TRUE,'awaiting_payment',$2,$3) RETURNING id`, [req.user.id, amount, `اشتراک پلن ${planSnapshot(settings, tier).label} ${months} ماهه کارت دیجیتال ${owned.rows[0].public_id}`]);
    const orderId = orderResult.rows[0].id;
    const subscription = await client.query(`INSERT INTO digital_card_subscriptions(card_id,user_id,plan_months,amount,order_id,plan_code,entitlements_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`, [cardId, req.user.id, months, amount, orderId, tier, JSON.stringify(planSnapshot(settings, tier))]);
    await client.query("COMMIT");
    res.status(201).json({ orderId, subscriptionId: subscription.rows[0].id, amount, planCode: tier, months });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create digital card subscription failed:", error.message);
    res.status(500).json({ message: "ایجاد سفارش اشتراک ممکن نشد" });
  } finally { client.release(); }
});

router.get("/admin/stats", requirePermission("digital_cards.manage"), async (_req, res) => {
  try {
    const [cards, events, daily, monthly] = await Promise.all([
      query("SELECT status,COUNT(*)::int AS count FROM digital_cards GROUP BY status ORDER BY status"),
      query("SELECT event_type,COUNT(*)::int AS count FROM digital_card_events GROUP BY event_type ORDER BY event_type"),
      query(`SELECT date_trunc('day',created_at)::date AS date,COUNT(*)::int AS count
        FROM digital_card_events WHERE created_at>=NOW()-INTERVAL '30 days'
        GROUP BY date_trunc('day',created_at)::date ORDER BY date DESC`),
      query(`SELECT date_trunc('month',created_at)::date AS month,COUNT(*)::int AS count
        FROM digital_card_events WHERE created_at>=NOW()-INTERVAL '12 months'
        GROUP BY date_trunc('month',created_at)::date ORDER BY month DESC`),
    ]);
    res.json({ cards: cards.rows, events: events.rows, daily: daily.rows, monthly: monthly.rows });
  } catch (error) { res.status(500).json({ message: "گزارش کارت‌ها در دسترس نیست" }); }
});

router.get("/admin/cards", requirePermission("digital_cards.manage"), async (req, res) => {
  try {
    const status = clean(req.query.status, 20);
    const allowedStatuses = new Set(["draft", "trial", "active", "expired"]);
    const filter = allowedStatuses.has(status) ? status : null;
    const result = await query(`SELECT c.id,c.user_id,c.public_id,c.title,c.status,c.created_at,c.trial_ends_at,u.name,u.lname,u.phone
      FROM digital_cards c JOIN users u ON u.id=c.user_id
      WHERE c.deleted_at IS NULL AND ($1::text IS NULL OR c.status=$1) ORDER BY c.created_at DESC LIMIT 500`, [filter]);
    res.json({ cards: result.rows });
  } catch (error) { res.status(500).json({ message: "فهرست کارت‌ها در دسترس نیست" }); }
});

router.get("/admin/subscriptions", requirePermission("digital_cards.manage"), async (_req, res) => {
  try {
    const result = await query(`SELECT s.id,s.card_id,s.user_id,s.plan_code,s.plan_months,s.amount,s.starts_at,s.ends_at,s.created_at,
        c.public_id,c.title,u.name,u.lname,u.phone,o.status AS order_status,o.payment_ref_number
      FROM digital_card_subscriptions s
      JOIN digital_cards c ON c.id=s.card_id JOIN users u ON u.id=s.user_id
      LEFT JOIN orders o ON o.id=s.order_id ORDER BY s.created_at DESC LIMIT 500`);
    res.json({ subscriptions: result.rows });
  } catch (error) { res.status(500).json({ message: "فهرست اشتراک‌ها در دسترس نیست" }); }
});

router.get("/admin/settings", requirePermission("digital_cards.manage"), async (_req, res) => {
  try { res.json(await getPlanSettings()); } catch (error) { res.status(500).json({ message: "تنظیمات در دسترس نیست" }); }
});

router.put("/admin/settings", requirePermission("digital_cards.manage"), async (req, res) => {
  const templateIds = paidTemplates.map((item) => item.id);
  const tierPriceKeys = TIERS.flatMap((tier) => [6, 12].map((months) => `plan_${tier}_${months}_price`));
  const tierActiveKeys = TIERS.flatMap((tier) => [6, 12].map((months) => `plan_${tier}_${months}_active`));
  const tierLimitKeys = TIERS.flatMap((tier) => Object.keys(DEFAULT_PLANS[tier].limits).map((key) => `plan_${tier}_${key}`));
  const tierFeatureKeys = TIERS.flatMap((tier) => Object.keys(DEFAULT_PLANS[tier].features).map((key) => `plan_${tier}_${key}`));
  const integerSettings = ["trial_days", "plan_6_price", "plan_12_price", "sms_template_id", "sms_reminder_days", ...templateIds.map((id) => `template_${id}_price`), ...tierPriceKeys, ...tierLimitKeys];
  const booleanSettings = ["plan_6_active", "plan_12_active", "sms_enabled", "sms_trial_started", "sms_trial_reminder", "sms_trial_expired", "sms_subscription_paid", "sms_subscription_reminder", "sms_subscription_expired", ...templateIds.map((id) => `template_${id}_active`), ...tierActiveKeys, ...tierFeatureKeys];
  const textSettings = ["sms_message_param", "sms_link_param"];
  const allowed = new Set([...integerSettings, ...booleanSettings, ...textSettings]);
  try {
    const current = await getPlanSettings();
    for (const { id } of paidTemplates) {
      const price = Number(req.body?.[`template_${id}_price`] ?? current[`template_${id}_price`] ?? 0);
      const active = req.body?.[`template_${id}_active`] ?? current[`template_${id}_active`] ?? false;
      if (active === true && (!Number.isSafeInteger(price) || price < 100)) return fail(res, 400, "برای فعال‌کردن فروش هر قالب، قیمت حداقل ۱۰۰ تومان وارد کنید");
    }
    for (const tier of TIERS) for (const months of [6, 12]) {
      const priceKey = `plan_${tier}_${months}_price`;
      const activeKey = `plan_${tier}_${months}_active`;
      const price = Number(req.body?.[priceKey] ?? current[priceKey] ?? (tier === "bronze" ? current[`plan_${months}_price`] : 0));
      const active = req.body?.[activeKey] ?? current[activeKey] ?? (tier === "bronze" && current[`plan_${months}_active`] !== false);
      if (active === true && (!Number.isSafeInteger(price) || price < 100)) return fail(res, 400, "برای فعال‌کردن هر پلن، قیمت حداقل ۱۰۰ تومان وارد کنید");
    }
    const nextMessageParam = clean(req.body?.sms_message_param ?? current.sms_message_param ?? "MESSAGE", 50);
    const nextLinkParam = clean(req.body?.sms_link_param ?? current.sms_link_param ?? "LINK", 50);
    if (nextMessageParam === nextLinkParam) return fail(res, 400, "نام پارامتر متن و پیوند باید متفاوت باشد");
    for (const [key, rawValue] of Object.entries(req.body || {})) if (allowed.has(key)) {
      let value = rawValue;
      if (integerSettings.includes(key)) {
        value = Number(rawValue);
        const max = key === "trial_days" ? 30 : key === "sms_reminder_days" ? 14 : tierLimitKeys.includes(key) ? 100000 : Number.MAX_SAFE_INTEGER;
        const min = key === "sms_template_id" ? 0 : (key === "trial_days" || key === "sms_reminder_days") ? 1 : 0;
        if (!Number.isSafeInteger(value) || value < min || value > max) return fail(res, 400, "مقدار تنظیم معتبر نیست");
      } else if (booleanSettings.includes(key)) {
        if (typeof rawValue !== "boolean") return fail(res, 400, "مقدار وضعیت باید روشن یا خاموش باشد");
      } else {
        value = clean(rawValue, 50);
        if (!/^[A-Za-z0-9_]{1,50}$/.test(value)) return fail(res, 400, "نام پارامتر پیامک معتبر نیست");
      }
      await query(`INSERT INTO digital_card_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [key, JSON.stringify(value)]);
      const legacyTier = key.match(/^plan_bronze_(6|12)_(price|active)$/);
      const oldTier = key.match(/^plan_(6|12)_(price|active)$/);
      const mirror = legacyTier ? `plan_${legacyTier[1]}_${legacyTier[2]}` : oldTier ? `plan_bronze_${oldTier[1]}_${oldTier[2]}` : null;
      if (mirror) await query(`INSERT INTO digital_card_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [mirror, JSON.stringify(value)]);
    }
    res.json(await getPlanSettings());
  } catch (error) { res.status(500).json({ message: "ذخیره تنظیمات ممکن نشد" }); }
});

module.exports = router;
