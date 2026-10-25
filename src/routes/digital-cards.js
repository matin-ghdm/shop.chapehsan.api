const crypto = require("crypto");
const express = require("express");
const { pool, query } = require("../db");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../lib/panel-permissions");
const qrCode = require("../lib/qr-code");

const router = express.Router();
const templates = new Set(["corporate", "minimal", "luxury", "shop", "medical"]);
const eventTypes = new Set(["view", "mobile", "phone", "map", "messenger", "social", "website", "email"]);
const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const fail = (res, status, message) => res.status(status).json({ message });
const isSiteAdmin = (user) => String(user?.role || "").trim().toLowerCase() === "admin";

async function getPlanSettings() {
  const result = await query("SELECT key, value FROM digital_card_settings");
  return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
}

async function publicCardBySlug(slug) {
  const result = await query(`
    SELECT c.*, COALESCE(s.ends_at, c.trial_ends_at) AS access_ends_at,
      (SELECT COUNT(*)::int FROM digital_card_events e WHERE e.card_id=c.id AND e.event_type='view') AS views
    FROM digital_cards c
    LEFT JOIN LATERAL (SELECT ends_at FROM digital_card_subscriptions WHERE card_id=c.id AND ends_at > NOW() ORDER BY ends_at DESC LIMIT 1) s ON TRUE
    WHERE c.public_id=$1 LIMIT 1`, [slug]);
  const card = result.rows[0];
  if (!card) return null;
  const accessEndsAt = card.access_ends_at ? new Date(card.access_ends_at) : null;
  const permitted = card.access_exempt === true || ((card.status === "active" || card.status === "trial") && accessEndsAt && accessEndsAt > new Date());
  return permitted ? card : { ...card, status: "expired", data: null };
}

router.get("/plans", async (_req, res) => {
  try {
    const settings = await getPlanSettings();
    res.json({ trialDays: Number(settings.trial_days ?? 7), plans: [
      { months: 6, price: Number(settings.plan_6_price ?? 0), active: settings.plan_6_active !== false },
      { months: 12, price: Number(settings.plan_12_price ?? 0), active: settings.plan_12_active !== false },
    ] });
  } catch (error) { res.status(500).json({ message: "دریافت تعرفه‌ها ممکن نشد" }); }
});

router.get("/public/:slug", async (req, res) => {
  try {
    const card = await publicCardBySlug(clean(req.params.slug, 32));
    if (!card) return fail(res, 404, "کارت پیدا نشد");
    if (card.status === "expired") return res.status(410).json({ message: "اعتبار این کارت به پایان رسیده است", expired: true });
    res.json({ card: { public_id: card.public_id, title: card.title, template: card.template, accent_color: card.accent_color, data: card.data, views: card.views, access_ends_at: card.access_ends_at } });
  } catch (error) { console.error("Public digital card failed:", error.message); res.status(500).json({ message: "نمایش کارت ممکن نشد" }); }
});

router.get("/public/:slug/qr.svg", async (req, res) => {
  try {
    const card = await query("SELECT public_id FROM digital_cards WHERE public_id=$1", [clean(req.params.slug, 32)]);
    if (!card.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const base = String(process.env.DIGITAL_CARD_PUBLIC_BASE_URL || "https://chapehsan.com").replace(/\/$/, "");
    const link = `${base}/c/${encodeURIComponent(card.rows[0].public_id)}`;
    const size = Number(req.query.size) || 512;
    const svg = qrCode.toSvg(qrCode.makeQrMatrix(link), { color: req.query.color, size, transparent: req.query.transparent === "true" });
    res.set({ "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": `attachment; filename="${card.rows[0].public_id}.svg"`, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" }).send(svg);
  } catch (error) { res.status(error.status || 500).json({ message: error.message || "ساخت QR ممکن نشد" }); }
});

router.get("/public/:slug/qr.png", async (req, res) => {
  try {
    const card = await query("SELECT public_id FROM digital_cards WHERE public_id=$1", [clean(req.params.slug, 32)]);
    if (!card.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const base = String(process.env.DIGITAL_CARD_PUBLIC_BASE_URL || "https://chapehsan.com").replace(/\/$/, "");
    const link = `${base}/c/${encodeURIComponent(card.rows[0].public_id)}`;
    const png = qrCode.toPng(qrCode.makeQrMatrix(link), { color: req.query.color, size: req.query.size, transparent: req.query.transparent === "true" });
    res.set({ "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${card.rows[0].public_id}.png"`, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" }).send(png);
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
    const esc = (value) => clean(value, 160).replace(/[\\,;]/g, "\\$&").replace(/\r?\n/g, "\\n");
    const phones = Array.isArray(d.phones) ? d.phones.filter((x) => x?.value && x.visible !== false) : [];
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc([d.firstName, d.lastName].filter(Boolean).join(" ") || card.title)}`];
    if (d.company) lines.push(`ORG:${esc(d.company)}`);
    if (d.job) lines.push(`TITLE:${esc(d.job)}`);
    for (const p of phones) lines.push(`TEL;TYPE=${p.kind === "landline" ? "WORK,VOICE" : "CELL"}:${esc(p.value)}`);
    if (d.email) lines.push(`EMAIL:${esc(d.email)}`);
    if (d.website) lines.push(`URL:${esc(d.website)}`);
    lines.push("END:VCARD");
    await query("INSERT INTO digital_card_events(card_id,event_type) VALUES($1,'vcf')", [card.id]);
    res.set({ "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="${card.public_id}.vcf"`, "X-Content-Type-Options": "nosniff" }).send(lines.join("\r\n"));
  } catch (error) { res.status(500).json({ message: "ساخت مخاطب ممکن نشد" }); }
});

router.use(authenticate);

router.get("/mine", async (req, res) => {
  try {
    const result = await query(`SELECT c.*,
      COALESCE((SELECT MAX(ends_at) FROM digital_card_subscriptions WHERE card_id=c.id), c.trial_ends_at) AS access_ends_at,
      (SELECT COUNT(*)::int FROM digital_card_events WHERE card_id=c.id AND event_type='view') AS views
      FROM digital_cards c WHERE c.user_id=$1 ORDER BY c.created_at DESC`, [req.user.id]);
    res.json({ cards: result.rows });
  } catch (error) { res.status(500).json({ message: "دریافت کارت‌ها ممکن نشد" }); }
});

router.post("/", async (req, res) => {
  const title = clean(req.body?.title || "کارت جدید", 120);
  const template = clean(req.body?.template || "corporate", 30);
  const isAdmin = isSiteAdmin(req.user);
  if (!templates.has(template)) return fail(res, 400, "قالب کارت معتبر نیست");
  try {
    const settings = await getPlanSettings();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [req.user.id]);
      const trial = isAdmin ? { rowCount: 1 } : await client.query("SELECT id FROM digital_cards WHERE user_id=$1 AND trial_started_at IS NOT NULL LIMIT 1", [req.user.id]);
      const trialDays = Math.max(1, Math.min(30, Number(settings.trial_days ?? 7)));
      const result = await client.query(`INSERT INTO digital_cards(user_id,public_id,title,template,data,status,trial_started_at,trial_ends_at,access_exempt)
        VALUES($1,$2,$3,$4,'{}'::jsonb,$5,CASE WHEN $6 THEN NULL ELSE NOW() END,CASE WHEN $6 THEN NULL ELSE NOW()+($7::text||' days')::interval END,$8) RETURNING *`,
        [req.user.id, crypto.randomBytes(8).toString("base64url"), title, template, isAdmin ? "active" : trial.rowCount ? "draft" : "trial", trial.rowCount > 0, trialDays, isAdmin]);
      await client.query("COMMIT");
      return res.status(201).json({ card: result.rows[0] });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } catch (error) { console.error("Create digital card failed:", error.message); res.status(500).json({ message: "ساخت کارت ممکن نشد" }); }
});

router.put("/:id", async (req, res) => {
  const data = req.body?.data;
  const template = clean(req.body?.template, 30);
  const color = clean(req.body?.accent_color, 7);
  if (!data || typeof data !== "object" || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > 100_000) return fail(res, 400, "اطلاعات کارت معتبر نیست");
  if (!templates.has(template) || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, "ظاهر کارت معتبر نیست");
  const title = clean([data.firstName, data.lastName].filter(Boolean).join(" ") || req.body?.title || "کارت دیجیتال", 120);
  try {
    const result = await query(`UPDATE digital_cards SET data=$1::jsonb,template=$2,accent_color=$3,title=$4,updated_at=NOW()
      WHERE id=$5 AND user_id=$6 RETURNING *`, [JSON.stringify(data), template, color, title, req.params.id, req.user.id]);
    if (!result.rowCount) return fail(res, 404, "کارت پیدا نشد");
    res.json({ card: result.rows[0] });
  } catch (error) { res.status(500).json({ message: "ذخیره کارت ممکن نشد" }); }
});

router.get("/:id/stats", async (req, res) => {
  try {
    const owned = await query("SELECT id FROM digital_cards WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (!owned.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const result = await query(`SELECT event_type, COUNT(*)::int AS count FROM digital_card_events WHERE card_id=$1 GROUP BY event_type ORDER BY event_type`, [req.params.id]);
    res.json({ events: result.rows });
  } catch (error) { res.status(500).json({ message: "گزارش کارت در دسترس نیست" }); }
});

router.get("/:id/subscriptions", async (req, res) => {
  try {
    const owned = await query("SELECT id FROM digital_cards WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (!owned.rowCount) return fail(res, 404, "کارت پیدا نشد");
    const result = await query(`SELECT s.id,s.plan_months,s.amount,s.starts_at,s.ends_at,s.created_at,o.id AS order_id,o.status AS order_status,o.payment_ref_number
      FROM digital_card_subscriptions s LEFT JOIN orders o ON o.id=s.order_id WHERE s.card_id=$1 ORDER BY s.created_at DESC`, [req.params.id]);
    res.json({ subscriptions: result.rows });
  } catch (error) { res.status(500).json({ message: "سوابق اشتراک در دسترس نیست" }); }
});

router.post("/subscriptions", async (req, res) => {
  const cardId = clean(req.body?.cardId, 50);
  const months = Number(req.body?.months);
  if (!cardId || ![6, 12].includes(months)) return fail(res, 400, "کارت یا پلن اشتراک معتبر نیست");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query("SELECT id,public_id FROM digital_cards WHERE id=$1 AND user_id=$2 FOR UPDATE", [cardId, req.user.id]);
    if (!owned.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "کارت پیدا نشد"); }
    if (isSiteAdmin(req.user)) {
      await client.query("UPDATE digital_cards SET access_exempt=TRUE,status='active',updated_at=NOW() WHERE id=$1", [cardId]);
      await client.query("COMMIT");
      return res.json({ free: true, cardId, status: "active" });
    }
    const priceKey = `plan_${months}_price`;
    const activeKey = `plan_${months}_active`;
    const settingsRows = await client.query("SELECT key,value FROM digital_card_settings WHERE key IN ($1,$2)", [priceKey, activeKey]);
    const settings = Object.fromEntries(settingsRows.rows.map((r) => [r.key, r.value]));
    const amount = Number(settings[priceKey] ?? 0);
    if (!Number.isSafeInteger(amount) || amount < 100 || settings[activeKey] === false) { await client.query("ROLLBACK"); return fail(res, 503, "این پلن در حال حاضر برای خرید فعال نیست"); }
    const orderResult = await client.query(`INSERT INTO orders(user_id,is_pickup,status,total_price,note)
      VALUES($1,TRUE,'awaiting_payment',$2,$3) RETURNING id`, [req.user.id, amount, `اشتراک ${months} ماهه کارت دیجیتال ${owned.rows[0].public_id}`]);
    const orderId = orderResult.rows[0].id;
    const subscription = await client.query(`INSERT INTO digital_card_subscriptions(card_id,user_id,plan_months,amount,order_id)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [cardId, req.user.id, months, amount, orderId]);
    await client.query("COMMIT");
    res.status(201).json({ orderId, subscriptionId: subscription.rows[0].id, amount });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create digital card subscription failed:", error.message);
    res.status(500).json({ message: "ایجاد سفارش اشتراک ممکن نشد" });
  } finally { client.release(); }
});

router.get("/admin/cards", requirePermission("digital_cards.manage"), async (_req, res) => {
  try {
    const result = await query(`SELECT c.id,c.user_id,c.public_id,c.title,c.status,c.created_at,c.trial_ends_at,u.name,u.lname,u.phone
      FROM digital_cards c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC LIMIT 500`);
    res.json({ cards: result.rows });
  } catch (error) { res.status(500).json({ message: "فهرست کارت‌ها در دسترس نیست" }); }
});

router.get("/admin/settings", requirePermission("digital_cards.manage"), async (_req, res) => {
  try { res.json(await getPlanSettings()); } catch (error) { res.status(500).json({ message: "تنظیمات در دسترس نیست" }); }
});

router.put("/admin/settings", requirePermission("digital_cards.manage"), async (req, res) => {
  const allowed = ["trial_days", "plan_6_price", "plan_12_price", "plan_6_active", "plan_12_active"];
  try {
    for (const key of allowed) if (req.body?.[key] !== undefined) {
      const value = ["trial_days", "plan_6_price", "plan_12_price"].includes(key) ? Number(req.body[key]) : Boolean(req.body[key]);
      if (typeof value === "number" && (!Number.isInteger(value) || value < 0 || (key === "trial_days" && value > 30))) return fail(res, 400, "مقدار تنظیم معتبر نیست");
      await query(`INSERT INTO digital_card_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [key, JSON.stringify(value)]);
    }
    res.json(await getPlanSettings());
  } catch (error) { res.status(500).json({ message: "ذخیره تنظیمات ممکن نشد" }); }
});

module.exports = router;
