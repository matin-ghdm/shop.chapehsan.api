const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMessage, notificationEnabled } = require("../src/services/digital-card-notifications");

test("digital card SMS is disabled until the existing SMS service and template are configured", () => {
  assert.equal(notificationEnabled({ sms_enabled: false, sms_template_id: 12 }, "trial_started"), false);
  assert.equal(notificationEnabled({ sms_enabled: true, sms_template_id: 0 }, "trial_started"), false);
});

test("an administrator can disable an individual notification type", () => {
  const settings = { sms_enabled: true, sms_template_id: 12, sms_trial_reminder: false };
  assert.equal(notificationEnabled(settings, "trial_reminder"), false);
  assert.equal(notificationEnabled(settings, "trial_started"), true);
});

test("SMS messages include the card title without control characters", () => {
  assert.equal(buildMessage("subscription_paid", "چاپ\nاحسان"), "چاپ احسان: پرداخت اشتراک کارت ویزیت دیجیتال شما با موفقیت تأیید شد.");
});

test("unknown notification kinds are rejected", () => {
  assert.throws(() => buildMessage("unrecognized", "کارت"), /نوع اعلان/);
  assert.equal(notificationEnabled({ sms_enabled: true, sms_template_id: 12 }, "unrecognized"), false);
});
