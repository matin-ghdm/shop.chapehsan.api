const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePermissions,
  isPanelAccount,
  hasPermission,
} = require("../src/lib/panel-permissions");

test("normalizes stored permissions and removes unknown or duplicate values", () => {
  assert.deepEqual(
    normalizePermissions(["orders.view", "unknown.permission", "orders.view"]),
    ["orders.view"],
  );
  assert.deepEqual(normalizePermissions("orders.view"), []);
});

test("admin has every permission and staff receives only assigned access", () => {
  assert.equal(hasPermission({ role: "admin" }, "settings.manage"), true);
  assert.equal(
    hasPermission({ role: "staff", permissions: ["products.manage"] }, "products.manage"),
    true,
  );
  assert.equal(
    hasPermission({ role: "staff", permissions: ["products.manage"] }, "orders.view"),
    false,
  );
});

test("order management includes viewing, while viewing does not grant editing", () => {
  assert.equal(
    hasPermission({ role: "staff", permissions: ["orders.manage"] }, "orders.view"),
    true,
  );
  assert.equal(
    hasPermission({ role: "staff", permissions: ["orders.view"] }, "orders.manage"),
    false,
  );
});

test("accounts without the staff or admin role cannot use stale permissions", () => {
  assert.equal(isPanelAccount({ role: null }), false);
  assert.equal(isPanelAccount({ role: "user" }), false);
  assert.equal(isPanelAccount({ role: "staff" }), true);
  assert.equal(
    hasPermission({ role: null, permissions: ["orders.manage"] }, "orders.view"),
    false,
  );
});
