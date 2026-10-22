const express = require("express");
const { query } = require("../db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_TYPES = new Set(["mobile", "tablet", "desktop", "unknown"]);

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "فقط ادمین مجاز است", code: "FORBIDDEN" });
  }
  next();
}

function validPagePath(value) {
  const path = String(value || "").trim();
  if (!path || path.length > 300 || !path.startsWith("/") || /[?#\\\s]/.test(path)) return null;
  if (path.startsWith("/dashboard") || path.startsWith("/api/")) return null;
  return path;
}

function validReferrerHost(value) {
  if (value == null || value === "") return null;
  const host = String(value).trim().toLowerCase();
  if (host.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) return null;
  return host;
}

router.post("/events", async (req, res) => {
  const body = req.body || {};
  const eventId = String(body.event_id || "");
  const visitorId = String(body.visitor_id || "");
  const pagePath = validPagePath(body.page_path);
  const deviceType = String(body.device_type || "unknown");
  if (!UUID_RE.test(eventId) || !UUID_RE.test(visitorId) || !pagePath || !DEVICE_TYPES.has(deviceType)) {
    return res.status(400).json({ message: "دادهٔ آمار معتبر نیست", code: "VALIDATION_ERROR" });
  }

  try {
    await query(
      `INSERT INTO site_analytics_events (event_id, visitor_id, event_name, page_path, referrer_host, device_type)
       VALUES ($1, $2, 'page_view', $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, visitorId, pagePath, validReferrerHost(body.referrer_host), deviceType],
    );
    res.status(202).json({ ok: true });
  } catch (err) {
    console.error("Store site analytics event failed:", err.message);
    res.status(503).json({ message: "ثبت آمار در حال حاضر ممکن نیست" });
  }
});

router.get("/admin", authenticate, requireAdmin, async (req, res) => {
  const requestedDays = Number.parseInt(String(req.query.days || "30"), 10);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  try {
    const [summary, daily, topPages, sources, devices, orders] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS page_views,
                COUNT(DISTINCT visitor_id)::int AS unique_visits
         FROM site_analytics_events
         WHERE created_at >= (((NOW() AT TIME ZONE 'Asia/Tehran')::date - ($1::int - 1))::timestamp AT TIME ZONE 'Asia/Tehran')`,
        [days],
      ),
      query(
        `WITH dates AS (
           SELECT generate_series(
             (NOW() AT TIME ZONE 'Asia/Tehran')::date - ($1::int - 1),
             (NOW() AT TIME ZONE 'Asia/Tehran')::date,
             INTERVAL '1 day'
           )::date AS day
         )
         SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
                COUNT(e.event_id)::int AS page_views,
                COUNT(DISTINCT e.visitor_id)::int AS unique_visits
         FROM dates d
         LEFT JOIN site_analytics_events e
           ON (e.created_at AT TIME ZONE 'Asia/Tehran')::date = d.day
         GROUP BY d.day
         ORDER BY d.day`,
        [days],
      ),
      query(
        `SELECT page_path, COUNT(*)::int AS page_views
         FROM site_analytics_events
         WHERE created_at >= (((NOW() AT TIME ZONE 'Asia/Tehran')::date - ($1::int - 1))::timestamp AT TIME ZONE 'Asia/Tehran')
         GROUP BY page_path ORDER BY page_views DESC, page_path LIMIT 10`,
        [days],
      ),
      query(
        `SELECT referrer_host AS source, COUNT(*)::int AS visits
         FROM site_analytics_events
         WHERE referrer_host IS NOT NULL
           AND created_at >= (((NOW() AT TIME ZONE 'Asia/Tehran')::date - ($1::int - 1))::timestamp AT TIME ZONE 'Asia/Tehran')
         GROUP BY referrer_host ORDER BY visits DESC, source LIMIT 8`,
        [days],
      ),
      query(
        `SELECT device_type, COUNT(*)::int AS page_views
         FROM site_analytics_events
         WHERE created_at >= (((NOW() AT TIME ZONE 'Asia/Tehran')::date - ($1::int - 1))::timestamp AT TIME ZONE 'Asia/Tehran')
         GROUP BY device_type ORDER BY page_views DESC`,
        [days],
      ),
      query(
        `SELECT COUNT(*)::int AS orders
         FROM orders
         WHERE created_at >= (((NOW() AT TIME ZONE 'Asia/Tehran')::date - ($1::int - 1))::timestamp AT TIME ZONE 'Asia/Tehran')`,
        [days],
      ),
    ]);

    res.set("Cache-Control", "no-store");
    res.json({
      days,
      summary: { ...summary.rows[0], orders: orders.rows[0].orders },
      daily: daily.rows,
      topPages: topPages.rows,
      sources: sources.rows,
      devices: devices.rows,
    });
  } catch (err) {
    console.error("Load site analytics failed:", err.message);
    res.status(500).json({ message: "دریافت آمار سایت ناموفق بود" });
  }
});

module.exports = router;
