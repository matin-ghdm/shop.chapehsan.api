const { query } = require("../db");

const DEFAULT_ORDER_SCHEDULE = Object.freeze({
  openWeekdays: [0, 1, 2, 3, 4, 6],
  orderOpenTime: "09:00",
  orderCutoffTime: "19:00",
  deliveryStartTime: "09:00",
  deliveryEndTime: "20:30",
});

function normalizeOrderSchedule(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    openWeekdays: Array.isArray(source.openWeekdays)
      ? [...new Set(source.openWeekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
      : [...DEFAULT_ORDER_SCHEDULE.openWeekdays],
    orderOpenTime: String(source.orderOpenTime || DEFAULT_ORDER_SCHEDULE.orderOpenTime),
    orderCutoffTime: String(source.orderCutoffTime || DEFAULT_ORDER_SCHEDULE.orderCutoffTime),
    deliveryStartTime: String(source.deliveryStartTime || DEFAULT_ORDER_SCHEDULE.deliveryStartTime),
    deliveryEndTime: String(source.deliveryEndTime || DEFAULT_ORDER_SCHEDULE.deliveryEndTime),
  };
}

function validateOrderScheduleSettings(value) {
  const settings = normalizeOrderSchedule(value);
  if (!settings.openWeekdays.length) throw Object.assign(new Error("حداقل یک روز کاری انتخاب کنید"), { status: 400 });
  for (const key of ["orderOpenTime", "orderCutoffTime", "deliveryStartTime", "deliveryEndTime"]) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings[key])) {
      throw Object.assign(new Error("ساعت واردشده معتبر نیست"), { status: 400 });
    }
  }
  if (settings.orderOpenTime >= settings.orderCutoffTime) {
    throw Object.assign(new Error("ساعت پایان ثبت سفارش باید بعد از ساعت شروع باشد"), { status: 400 });
  }
  if (settings.deliveryStartTime > settings.deliveryEndTime) {
    throw Object.assign(new Error("ساعت پایان ارسال باید بعد از ساعت شروع باشد"), { status: 400 });
  }
  return settings;
}

async function getOrderScheduleSettings() {
  const result = await query("SELECT settings FROM order_schedule_settings WHERE id = 1");
  return normalizeOrderSchedule(result.rows[0]?.settings);
}

async function saveOrderScheduleSettings(value) {
  const settings = validateOrderScheduleSettings(value);
  const result = await query(
    `INSERT INTO order_schedule_settings (id, settings, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
     RETURNING settings`,
    [JSON.stringify(settings)],
  );
  return normalizeOrderSchedule(result.rows[0].settings);
}

module.exports = {
  DEFAULT_ORDER_SCHEDULE,
  normalizeOrderSchedule,
  validateOrderScheduleSettings,
  getOrderScheduleSettings,
  saveOrderScheduleSettings,
};
