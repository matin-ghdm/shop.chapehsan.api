const { pool, query } = require("../db");
const smsir = require("./smsir");

const NOTIFICATION_SETTINGS = {
  trial_started: "sms_trial_started",
  trial_reminder: "sms_trial_reminder",
  trial_expired: "sms_trial_expired",
  subscription_paid: "sms_subscription_paid",
  subscription_reminder: "sms_subscription_reminder",
  subscription_expired: "sms_subscription_expired",
};

const MESSAGE_TEXT = {
  trial_started: "دورهٔ آزمایشی کارت ویزیت دیجیتال شما فعال شد.",
  trial_reminder: "دورهٔ آزمایشی کارت ویزیت دیجیتال شما به‌زودی پایان می‌یابد.",
  trial_expired: "دورهٔ آزمایشی کارت ویزیت دیجیتال شما پایان یافته است.",
  subscription_paid: "پرداخت اشتراک کارت ویزیت دیجیتال شما با موفقیت تأیید شد.",
  subscription_reminder: "اعتبار کارت ویزیت دیجیتال شما به‌زودی پایان می‌یابد.",
  subscription_expired: "اعتبار کارت ویزیت دیجیتال شما پایان یافته است.",
};

function parseSetting(value) {
  return value && typeof value === "object" && Object.hasOwn(value, "value")
    ? value.value
    : value;
}

function notificationEnabled(settings, kind) {
  const eventSetting = NOTIFICATION_SETTINGS[kind];
  return Boolean(eventSetting && settings.sms_enabled === true && settings[eventSetting] !== false && Number(settings.sms_template_id) > 0);
}

function buildMessage(kind, title) {
  const text = MESSAGE_TEXT[kind];
  if (!text) throw new Error("نوع اعلان کارت دیجیتال معتبر نیست");
  const safeTitle = String(title || "کارت دیجیتال").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  return `${safeTitle}: ${text}`;
}

async function getSettings() {
  const result = await query("SELECT key,value FROM digital_card_settings");
  return Object.fromEntries(result.rows.map((row) => [row.key, parseSetting(row.value)]));
}

async function enqueueNotification(cardId, kind, suffix = kind) {
  if (!NOTIFICATION_SETTINGS[kind]) return false;
  const settings = await getSettings();
  if (!notificationEnabled(settings, kind)) return false;
  const key = String(suffix).slice(0, 120);
  const result = await query(`INSERT INTO digital_card_notifications(card_id,notification_key,kind)
    VALUES($1,$2,$3) ON CONFLICT(card_id,notification_key) DO NOTHING RETURNING id`, [cardId, key, kind]);
  return result.rowCount > 0;
}

async function enqueueRows(rows, kind, keyForRow) {
  if (!rows.length) return;
  const cardIds = rows.map((row) => row.id || row.card_id);
  const keys = rows.map((row) => String(keyForRow(row)).slice(0, 120));
  await query(`INSERT INTO digital_card_notifications(card_id,notification_key,kind)
    SELECT batch.card_id,batch.notification_key,$3
    FROM unnest($1::uuid[],$2::text[]) AS batch(card_id,notification_key)
    ON CONFLICT(card_id,notification_key) DO NOTHING`, [cardIds, keys, kind]);
}

async function enqueueDueReminders(settings) {
  if (settings.sms_enabled !== true) return;
  const reminderDays = Math.max(1, Math.min(14, Number(settings.sms_reminder_days) || 2));
  const tasks = [];
  if (notificationEnabled(settings, "trial_reminder")) {
    const result = await query(`SELECT id FROM digital_cards WHERE status='trial'
      AND trial_ends_at > NOW() AND trial_ends_at <= NOW()+($1::text||' days')::interval`, [reminderDays]);
    tasks.push(enqueueRows(result.rows, "trial_reminder", () => "trial_reminder"));
  }
  if (notificationEnabled(settings, "trial_expired")) {
    const result = await query(`SELECT id FROM digital_cards WHERE status='trial' AND trial_ends_at <= NOW()`);
    tasks.push(enqueueRows(result.rows, "trial_expired", () => "trial_expired"));
  }
  if (notificationEnabled(settings, "subscription_reminder")) {
    const result = await query(`SELECT s.id AS subscription_id,s.card_id FROM digital_card_subscriptions s
      JOIN digital_cards c ON c.id=s.card_id
      WHERE s.starts_at IS NOT NULL AND s.ends_at > NOW()
        AND s.ends_at <= NOW()+($1::text||' days')::interval
        AND s.ends_at=(SELECT MAX(latest.ends_at) FROM digital_card_subscriptions latest WHERE latest.card_id=s.card_id)
        AND c.status='active'`, [reminderDays]);
    tasks.push(enqueueRows(result.rows, "subscription_reminder", (row) => `subscription_reminder_${row.subscription_id}`));
  }
  if (notificationEnabled(settings, "subscription_expired")) {
    const result = await query(`SELECT s.id AS subscription_id,s.card_id FROM digital_card_subscriptions s
      JOIN digital_cards c ON c.id=s.card_id
      WHERE s.starts_at IS NOT NULL AND s.ends_at <= NOW()
        AND s.ends_at=(SELECT MAX(latest.ends_at) FROM digital_card_subscriptions latest WHERE latest.card_id=s.card_id)
        AND c.status='active'`);
    tasks.push(enqueueRows(result.rows, "subscription_expired", (row) => `subscription_expired_${row.subscription_id}`));
  }
  await Promise.all(tasks);
}

async function claimNotifications(limit = 20) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`WITH selected AS (
        SELECT id FROM digital_card_notifications
        WHERE attempts < 5 AND (
          (status='pending' AND next_attempt_at <= NOW()) OR
          (status='sending' AND updated_at < NOW()-INTERVAL '10 minutes')
        ) ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1
      )
      UPDATE digital_card_notifications n SET status='sending',attempts=n.attempts+1,updated_at=NOW()
      FROM selected WHERE n.id=selected.id
      RETURNING n.id,n.card_id,n.kind,n.attempts`, [limit]);
    await client.query("COMMIT");
    if (!result.rowCount) return [];
    const details = await query(`SELECT n.id,n.card_id,n.kind,n.attempts,c.title,c.public_id,u.phone
      FROM digital_card_notifications n JOIN digital_cards c ON c.id=n.card_id
      JOIN users u ON u.id=c.user_id WHERE n.id=ANY($1::uuid[])`, [result.rows.map((row) => row.id)]);
    return details.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function sendClaimedNotification(item, settings) {
  if (!notificationEnabled(settings, item.kind)) {
    await query("UPDATE digital_card_notifications SET status='skipped',updated_at=NOW() WHERE id=$1", [item.id]);
    return;
  }
  try {
    const messageParam = String(settings.sms_message_param || "MESSAGE").trim();
    const linkParam = String(settings.sms_link_param || "LINK").trim();
    if (!/^[A-Za-z0-9_]{1,50}$/.test(messageParam) || !/^[A-Za-z0-9_]{1,50}$/.test(linkParam) || messageParam === linkParam) {
      throw new Error("پارامترهای قالب پیامک معتبر نیستند");
    }
    const params = [
      { name: messageParam, value: buildMessage(item.kind, item.title) },
      { name: linkParam, value: "https://chapehsan.com/my-digital-cards" },
    ];
    await smsir.sendTemplate(item.phone, Number(settings.sms_template_id), params);
    await query(`UPDATE digital_card_notifications SET status='sent',sent_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1`, [item.id]);
  } catch (error) {
    const status = item.attempts >= 5 ? "failed" : "pending";
    const delayMinutes = Math.min(60, item.attempts * 5);
    await query(`UPDATE digital_card_notifications SET status=$2,
      next_attempt_at=NOW()+($3::text||' minutes')::interval,last_error=$4,updated_at=NOW() WHERE id=$1`,
      [item.id, status, delayMinutes, String(error?.message || "SMS delivery failed").slice(0, 300)]);
    console.error("Digital card SMS notification failed:", error?.message || "unknown error");
  }
}

async function runDigitalCardNotificationWorker() {
  const settings = await getSettings();
  if (settings.sms_enabled !== true || Number(settings.sms_template_id) < 1) return;
  await enqueueDueReminders(settings);
  const notifications = await claimNotifications();
  for (const notification of notifications) await sendClaimedNotification(notification, settings);
}

function startDigitalCardNotificationWorker(intervalMs = 5 * 60 * 1000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runDigitalCardNotificationWorker(); }
    catch (error) { console.error("Digital card notification worker failed:", error?.message || "unknown error"); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  MESSAGE_TEXT,
  NOTIFICATION_SETTINGS,
  buildMessage,
  notificationEnabled,
  enqueueNotification,
  runDigitalCardNotificationWorker,
  startDigitalCardNotificationWorker,
};
