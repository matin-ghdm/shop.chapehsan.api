const {query}=require('../db');
async function ensureOccasionCalendar(){
 await query(`CREATE TABLE IF NOT EXISTS occasion_calendar (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, message TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('congratulation','condolence','notice')),
 date_mode TEXT NOT NULL CHECK(date_mode IN ('once','jalali_annual')), event_date TEXT,
 jalali_month INTEGER, jalali_day INTEGER,
 before_days INTEGER NOT NULL DEFAULT 3 CHECK(before_days BETWEEN 0 AND 30),
 after_days INTEGER NOT NULL DEFAULT 0 CHECK(after_days BETWEEN 0 AND 30),
 priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 100),
 is_active BOOLEAN NOT NULL DEFAULT TRUE, link_url TEXT NOT NULL DEFAULT '', link_label TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
}
module.exports={ensureOccasionCalendar};
