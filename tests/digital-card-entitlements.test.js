const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_PLANS, planPrice, planSnapshot, publicCardData, publicPlans, validateCardData } = require("../src/services/digital-card-entitlements");

test("three plan defaults keep existing bronze prices as the compatibility fallback", () => {
  assert.deepEqual(Object.keys(DEFAULT_PLANS), ["bronze", "silver", "gold"]);
  assert.deepEqual(planPrice({ plan_6_price: 490000, plan_12_price: 790000 }, "bronze", 6), { price: 490000, active: true });
  assert.deepEqual(planPrice({ plan_bronze_6_price: 600000, plan_6_price: 490000 }, "bronze", 6), { price: 600000, active: true });
  assert.deepEqual(planPrice({}, "silver", 12), { price: 0, active: false });
});

test("plan limits are configurable and snapshots preserve their purchase-time values", () => {
  const plan = planSnapshot({ plan_gold_activeCards: 8, plan_gold_storageMb: 750, plan_gold_leadForms: false }, "gold");
  assert.equal(plan.limits.activeCards, 8);
  assert.equal(plan.limits.storageMb, 750);
  assert.equal(plan.features.leadForms, false);
});

test("downgrade validation preserves existing over-limit data but blocks adding more", () => {
  const goldData = {
    phones: [{}, {}, {}, {}, {}, {}],
    customLinks: [{}, {}, {}, {}, {}, {}],
    addresses: [{}, {}, {}],
    services: [{}, {}],
    gallery: [{}, {}],
    products: [{}, {}],
    catalogs: [{}, {}],
    whatsappCtaEnabled: true,
    leadFormEnabled: true,
  };
  const bronze = planSnapshot({}, "bronze");
  assert.deepEqual(validateCardData(goldData, goldData, bronze), []);
  const expanded = { ...goldData, phones: [...goldData.phones, {}], leadFormEnabled: false };
  const errors = validateCardData(expanded, goldData, bronze);
  assert.ok(errors.some((error) => error.field === "phonesPerCard"));
});

test("public card projection hides features beyond the active plan without mutating saved data", () => {
  const data = { phones: [{}, {}, {}, {}], socialLinks: [{}, {}, {}, {}], services: [{ title: "old" }], products: [{ title: "private" }], catalog: "https://example.com/catalog.pdf", leadFormEnabled: true };
  const bronze = planSnapshot({}, "bronze");
  const visible = publicCardData(data, bronze);
  assert.equal(visible.phones.length, 3);
  assert.equal(visible.socialLinks.length, 4); // Social links are included before user links only when present in the saved set.
  assert.equal(visible.services.length, 0);
  assert.equal(visible.products.length, 0);
  assert.equal("catalog" in visible, false);
  assert.equal(visible.leadFormEnabled, false);
  assert.equal(data.services.length, 1);
  assert.equal(data.products.length, 1);
});

test("public plan data contains only the three tiers and both durations", () => {
  const plans = publicPlans({ plan_6_price: 490000, plan_12_price: 790000 });
  assert.deepEqual(plans.map((plan) => plan.code), ["bronze", "silver", "gold"]);
  assert.deepEqual(plans.map((plan) => plan.durations.map((duration) => duration.months)), [[6, 12], [6, 12], [6, 12]]);
  assert.equal(plans[1].durations[0].active, false);
});
