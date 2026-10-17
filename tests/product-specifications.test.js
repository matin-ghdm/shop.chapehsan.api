const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeProductOptions, quoteProduct } = require("../src/services/product-options");

test("product-specific specifications survive normalization without affecting price", () => {
  const input = { variants: [], specifications: [{ label: " جنس ", value: " بنر ایرانی درجه‌یک " }] };
  const saved = normalizeProductOptions(input);
  assert.deepEqual(saved.specifications, [{ label: "جنس", value: "بنر ایرانی درجه‌یک" }]);
  assert.deepEqual(normalizeProductOptions(saved), saved);
  assert.equal(quoteProduct({ price: 123000, product_options: saved }, null).price, 123000);
});
test("explicitly empty specifications remain distinct from inherited defaults", () => {
  assert.equal(normalizeProductOptions({ variants: [] }).specifications, undefined);
  assert.deepEqual(normalizeProductOptions({ variants: [], specifications: [] }).specifications, []);
});
test("reject malformed, blank, excessive, or oversized specifications", () => {
  for (const specifications of ["text", [null], [{ label: "", value: "x" }], [{ label: "x", value: " " }], [{ label: "x", value: "a".repeat(1001) }], Array(31).fill({ label: "x", value: "y" })]) {
    assert.throws(() => normalizeProductOptions({ variants: [], specifications }), { code: "VALIDATION_ERROR" });
  }
});
