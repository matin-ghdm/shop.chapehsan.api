const { query } = require("../db");

async function ensureSiteAnalytics() {
  await query(`
    CREATE TABLE IF NOT EXISTS site_analytics_events (
      event_id UUID PRIMARY KEY,
      visitor_id UUID NOT NULL,
      event_name TEXT NOT NULL CHECK (event_name IN ('page_view')),
      page_path VARCHAR(300) NOT NULL,
      referrer_host VARCHAR(253),
      device_type TEXT NOT NULL CHECK (device_type IN ('mobile', 'tablet', 'desktop', 'unknown')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS site_analytics_events_created_at_idx
    ON site_analytics_events (created_at DESC)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS site_analytics_events_path_created_idx
    ON site_analytics_events (page_path, created_at DESC)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS site_analytics_events_visitor_created_idx
    ON site_analytics_events (visitor_id, created_at DESC)
  `);
}

module.exports = { ensureSiteAnalytics };
