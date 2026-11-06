const test = require("node:test");
const assert = require("node:assert/strict");

test("worker stores the provider response on acceptance and rejection", async (t) => {
  const dbPath = require.resolve("../src/db");
  const servicePath = require.resolve("../src/services/digital-card-notifications");
  const updates = [];
  const settings = { sms_enabled: true, sms_template_id: 962873, sms_message_param: "STATUS", sms_trial_reminder: false, sms_trial_expired: false, sms_subscription_reminder: false, sms_subscription_expired: false };
  const item = { id: "notification", kind: "trial_started", phone: "09123456789", attempts: 1 };
  const query = async (sql, params) => {
    if (sql.startsWith("SELECT key")) return { rows: Object.entries(settings).map(([key, value]) => ({ key, value })) };
    if (sql.startsWith("SELECT n.id")) return { rows: [item] };
    updates.push({ sql, params }); return { rows: [] };
  };
  const originalDb = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query, pool: { connect: async () => ({ query: async sql => sql.includes("WITH selected") ? { rowCount: 1, rows: [item] } : {}, release() {} }) } } };
  delete require.cache[servicePath];
  t.after(() => { delete require.cache[servicePath]; if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath]; });
  const sms = require("../src/services/smsir");
  const payload = { status: 1, data: { messageId: 1234, cost: 1 }, message: "Success" };
  const mock = t.mock.method(sms, "sendTemplate", async () => payload);
  const { runDigitalCardNotificationWorker } = require(servicePath);
  await runDigitalCardNotificationWorker();
  assert.match(updates[0].sql, /status='sent'/);
  assert.deepEqual(JSON.parse(updates[0].params[1]), payload);
  const failure = Object.assign(new Error("Rejected"), { providerResponse: { status: 10, message: "Rejected" }, providerHttpStatus: 400 });
  mock.mock.mockImplementation(async () => { throw failure; });
  for (const attempts of [1, 5]) {
    updates.length = 0; item.attempts = attempts;
    await runDigitalCardNotificationWorker();
    assert.equal(updates[0].params[1], attempts === 5 ? "failed" : "pending");
    assert.deepEqual(JSON.parse(updates[0].params[4]), failure.providerResponse);
    assert.equal(updates[0].params[5], 400);
  }
});
