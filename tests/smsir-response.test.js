const test = require("node:test");
const assert = require("node:assert/strict");
const { sendTemplate } = require("../src/services/smsir");

test("provider responses survive success and failures without exposing the request", async (t) => {
  const originalKey = process.env.SMSIR_API_KEY;
  process.env.SMSIR_API_KEY = "test-key-never-return";
  t.after(() => { if (originalKey === undefined) delete process.env.SMSIR_API_KEY; else process.env.SMSIR_API_KEY = originalKey; });
  const payload = { status: 1, message: "Success", data: { messageId: 1234, cost: 1 } };
  const mock = t.mock.method(global, "fetch", async () => new Response(JSON.stringify(payload), { status: 200 }));
  assert.deepEqual(await sendTemplate("09123456789", 962873, [{ name: "STATUS", value: "test" }]), payload);
  for (const httpStatus of [200, 400, 503]) {
    const failure = { status: 123, message: "Template rejected", data: null };
    mock.mock.mockImplementation(async () => new Response(JSON.stringify(failure), { status: httpStatus }));
    await assert.rejects(sendTemplate("09123456789", 962873, [{ name: "STATUS", value: "test" }]), error => {
      assert.deepEqual(error.providerResponse, failure);
      assert.equal(error.providerHttpStatus, httpStatus);
      assert.equal(JSON.stringify(error).includes("test-key-never-return"), false);
      return true;
    });
  }
  mock.mock.mockImplementation(async () => new Response("unavailable", { status: 502 }));
  await assert.rejects(sendTemplate("09123456789", 962873, [{ name: "STATUS", value: "test" }]), error => error.providerResponse === null && error.providerHttpStatus === 502);
});
