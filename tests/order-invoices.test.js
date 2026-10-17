const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeInvoicePayload, issueInvoice } = require("../src/services/orders");
const { pool } = require("../src/db");

test("company invoices require a legal name and national identifier", () => {
  assert.throws(
    () => normalizeInvoicePayload({ invoice_type: "company", invoice_name: "شرکت نمونه" }),
    (error) => error.code === "INVOICE_NATIONAL_ID_REQUIRED",
  );
  assert.throws(
    () => normalizeInvoicePayload({ invoice_type: "company", invoice_national_id: "123" }),
    (error) => error.code === "INVOICE_NAME_REQUIRED",
  );
});

test("invoice data is trimmed and preserves the supported recipient details", () => {
  assert.deepEqual(
    normalizeInvoicePayload({
      invoice_type: "company",
      invoice_name: "  شرکت نمونه  ",
      invoice_national_id: " 1234567890 ",
      invoice_economic_code: " 9988 ",
      invoice_registration_number: " 77 ",
      invoice_phone: " 02112345678 ",
      invoice_address: " تهران، خیابان نمونه ",
      invoice_postal_code: " 1234567890 ",
    }),
    {
      invoice_type: "company",
      invoice_name: "شرکت نمونه",
      invoice_national_id: "1234567890",
      invoice_economic_code: "9988",
      invoice_registration_number: "77",
      invoice_phone: "02112345678",
      invoice_address: "تهران، خیابان نمونه",
      invoice_postal_code: "1234567890",
    },
  );
});

test("personal invoice can omit the national identifier", () => {
  assert.equal(
    normalizeInvoicePayload({ invoice_type: "personal", invoice_name: "نام خریدار" }).invoice_national_id,
    "",
  );
});

test("simultaneous issue requests can create only one invoice", async () => {
  let order = { id: "order-1", user_id: "customer-1", invoice_issued_at: null };
  let locked = false;
  const waiters = [];
  const releaseLock = () => {
    locked = false;
    waiters.shift()?.();
  };
  pool.connect = async () => ({
    release() {},
    async query(sql, values = []) {
      if (sql === "BEGIN") {
        if (locked) await new Promise((resolve) => waiters.push(resolve));
        locked = true;
        return { rows: [] };
      }
      if (sql.includes("SELECT id, user_id") && sql.includes("FOR UPDATE")) {
        return { rows: [{ ...order }] };
      }
      if (sql.startsWith("UPDATE orders SET")) {
        order = {
          ...order,
          invoice_type: values[0],
          invoice_name: values[1],
          invoice_national_id: values[2],
          invoice_issued_at: "2026-10-17T10:00:00.000Z",
        };
        return { rows: [{ ...order }] };
      }
      if (sql.startsWith("SELECT id, order_id, design_id")) return { rows: [] };
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        releaseLock();
        return { rows: [] };
      }
      throw new Error(`Unexpected query in invoice test: ${sql}`);
    },
  });

  const payload = { invoice_type: "company", invoice_name: "شرکت نمونه", invoice_national_id: "1234567890" };
  const results = await Promise.allSettled([
    issueInvoice("order-1", payload, { id: "customer-1", role: "customer" }),
    issueInvoice("order-1", payload, { id: "customer-1", role: "customer" }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejection = results.find((result) => result.status === "rejected");
  assert.equal(rejection.reason.code, "INVOICE_ALREADY_ISSUED");
  assert.equal(order.invoice_issued_at, "2026-10-17T10:00:00.000Z");
});
