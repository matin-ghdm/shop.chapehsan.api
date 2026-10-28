const test = require("node:test");
const assert = require("node:assert/strict");
const { planSnapshot, publicCardData } = require("../src/services/digital-card-entitlements");

test("one card can expose gold sections after upgrade and hide them again without losing saved content", () => {
  const source = {
    firstName: "Sample", firstNameColor: "#123456", firstNameShadow: false,
    phones: Array.from({ length: 10 }, (_, index) => ({ value: String(index) })),
    addresses: Array.from({ length: 10 }, (_, index) => ({ value: String(index) })),
    services: Array.from({ length: 30 }, (_, index) => ({ title: `Service ${index}` })),
    gallery: Array.from({ length: 30 }, (_, index) => ({ url: `https://example.com/${index}.jpg` })),
    products: Array.from({ length: 20 }, (_, index) => ({ title: `Product ${index}`, category: "Sample" })),
    catalogs: Array.from({ length: 3 }, (_, index) => ({ url: `https://example.com/${index}.pdf` })),
    productCategories: ["Sample"], whatsappCtaEnabled: true, whatsappCtaMessage: "Hello", leadFormEnabled: true,
  };
  const original = structuredClone(source);
  const bronze = publicCardData(source, planSnapshot({}, "bronze"));
  assert.equal(bronze.phones.length, 3);
  assert.equal(bronze.services.length, 0);
  assert.equal(bronze.products.length, 0);
  assert.equal(bronze.leadFormEnabled, false);
  assert.equal(bronze.productCategories, undefined);
  const gold = publicCardData(source, planSnapshot({}, "gold"));
  for (const key of ["phones", "addresses", "services", "gallery", "products", "catalogs"]) assert.equal(gold[key].length, source[key].length);
  assert.deepEqual(gold.productCategories, ["Sample"]);
  assert.equal(gold.leadFormEnabled, true);
  assert.equal(gold.whatsappCtaEnabled, true);
  const silver = publicCardData(source, planSnapshot({}, "silver"));
  assert.equal(silver.services.length, 10);
  assert.equal(silver.gallery.length, 6);
  assert.equal(silver.products.length, 0);
  assert.equal(silver.leadFormEnabled, false);
  assert.equal(silver.firstNameColor, "#123456");
  assert.equal(silver.firstNameShadow, false);
  assert.deepEqual(source, original);
});
