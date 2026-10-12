const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeProductOptions, quoteProduct } = require("../src/services/product-options");
const wall = { id: "wall", name: "دیواری", kind: "wall", image_path: "/wall.jpg", width_cm: 300, height_cm: 100, price: 950000, custom_size: { enabled: true, price_per_m2: 300000 }, extras: [] };
const stand = { ...wall, id: "stand", name: "استندی", kind: "stand", image_path: "/stand.jpg", width_cm: 90, height_cm: 200, price: 550000, custom_size: { enabled: false, price_per_m2: 0 }, extras: [{ id: "base", name: "فلکه‌ای", price: 200000 }, { id: "rollup", name: "رول‌آپ", price: 600000 }] };
const design = { price: 550000, product_options: { variants: [wall, stand] } };
test("separate images, sizes and optional services determine the price", () => {
  assert.equal(quoteProduct(design, { variant_id: "wall" }).price, 950000);
  const quote = quoteProduct(design, { variant_id: "stand", extra_ids: ["base"] });
  assert.equal(quote.price, 750000); assert.equal(quote.selection.image_path, "/stand.jpg"); assert.equal(quote.selection.width_cm, 90);
  assert.equal(quoteProduct(design, { variant_id: "stand", extra_ids: ["rollup"] }).price, 1150000);
  assert.equal(quoteProduct(design, { variant_id: "stand", extra_ids: [], price: 1 }).price, 550000);
});
test("custom dimensions use the configured area rate and reject unavailable or invalid options", () => {
  assert.equal(quoteProduct(design, { variant_id: "wall", custom_size: true, width_cm: 200, height_cm: 150 }).price, 900000);
  for (const selection of [{ variant_id: "missing" }, { variant_id: "wall", extra_ids: ["base"] }, { variant_id: "stand", extra_ids: ["base", "base"] }, { variant_id: "stand", custom_size: true }, { variant_id: "wall", custom_size: true, width_cm: -1, height_cm: 100 }]) assert.throws(() => quoteProduct(design, selection), { code: "VALIDATION_ERROR" });
});
test("legacy products work without variants; malformed configurations cannot be saved", () => {
  assert.equal(quoteProduct({ price: 500000 }, null).price, 500000);
  assert.deepEqual(normalizeProductOptions(), { variants: [] });
  for (const variants of [[{ ...wall, price: -1 }], [wall, wall], [{ ...wall, image_path: "javascript:alert(1)" }], [{ ...wall, custom_size: { enabled: true, price_per_m2: 0 } }]]) assert.throws(() => normalizeProductOptions({ variants }), { code: "VALIDATION_ERROR" });
});
