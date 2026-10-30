const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const routePath = require.resolve("../src/routes/digital-cards");
const actualRequire = createRequire(routePath);

function harness(initial = {}, options = {}) {
  const routes = new Map();
  let settings = { ...initial };
  let pending = null;
  const calls = [];
  async function query(sql, args = []) {
    calls.push(sql);
    if (sql === "BEGIN") pending = { ...settings };
    else if (sql === "ROLLBACK") pending = null;
    else if (sql === "COMMIT") { settings = pending; pending = null; }
    else if (/SELECT key,\s*value FROM digital_card_settings/.test(sql)) return { rows: Object.entries(pending || settings).map(([key, value]) => ({ key, value })) };
    else if (/INSERT INTO digital_card_settings/.test(sql)) {
      if (args[0] === options.failKey) throw new Error("database write failed");
      (pending || settings)[args[0]] = JSON.parse(args[1]);
    } else if (/SELECT id,data/.test(sql)) return { rowCount: 1, rows: [{ id: "card-1", data: {}, ...(sql.includes(",template") ? { template: options.currentTemplate || "smart" } : {}) }] };
    else if (/UPDATE digital_cards SET data/.test(sql)) return { rowCount: 1, rows: [{ id: "card-1", template: args[1] }] };
    else if (/digital_card_template_purchases/.test(sql)) return { rows: [{ template: "luxury" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  const router = { use() {} };
  for (const verb of ["get", "post", "put", "patch", "delete"]) router[verb] = (path, ...handlers) => routes.set(`${verb} ${path}`, handlers);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(routePath, "utf8"), {
    module, Buffer, URL, process, console,
    require(name) {
      if (name === "express") return { Router: () => router };
      if (name === "../db") return { query, pool: { connect: async () => ({ query, release() {} }) } };
      if (name === "../middleware/auth") return { authenticate() {} };
      if (name === "../lib/qr-code") return {};
      if (name === "../lib/panel-permissions") return { requirePermission: (permission) => Object.assign(() => {}, { permission }) };
      return actualRequire(name);
    },
  });
  async function call(verb, path, body, role = "user") {
    let status = 200, data;
    const response = { status(code) { status = code; return this; }, set() { return this; }, json(value) { data = value; return this; } };
    const handlers = routes.get(`${verb} ${path}`);
    assert.ok(handlers, `route ${verb} ${path} exists`);
    await handlers.at(-1)({ body, user: { id: 1, role }, params: { id: "card-1" } }, response);
    return { status, data };
  }
  return { call, calls, routes, settings: () => settings };
}

test("template management is protected by the existing management permission and defaults preserve availability", async () => {
  const api = harness();
  for (const verb of ["get", "put"]) assert.equal(api.routes.get(`${verb} /admin/templates`)[0].permission, "digital_cards.manage");
  const result = await api.call("get", "/admin/templates");
  assert.equal(result.status, 200);
  assert.equal(result.data.templates.length, 11);
  assert.ok(result.data.templates.every((item) => item.enabled));
});

test("administrative status updates persist and public choices cannot reactivate a disabled owned template", async () => {
  const api = harness();
  const result = await api.call("put", "/admin/templates", { templates: [{ id: "ribbon", enabled: false }, { id: "luxury", enabled: false }] });
  assert.equal(result.status, 200);
  assert.equal(api.settings().template_ribbon_enabled, false);
  const listed = await api.call("get", "/templates");
  for (const id of ["ribbon", "luxury"]) {
    const template = listed.data.templates.find((item) => item.id === id);
    assert.equal(template.enabled, false);
    assert.equal(template.active, false);
    assert.equal(template.owned, true);
  }
});

test("invalid and duplicate updates are rejected before writing; failed batches roll back", async () => {
  for (const templates of [[{ id: "unknown", enabled: true }], [{ id: "smart", enabled: "false" }], [{ id: "smart", enabled: true }, { id: "smart", enabled: false }]]) {
    const api = harness();
    assert.equal((await api.call("put", "/admin/templates", { templates })).status, 400);
    assert.equal(api.calls.length, 0);
  }
  const api = harness({}, { failKey: "template_ribbon_enabled" });
  assert.equal((await api.call("put", "/admin/templates", { templates: [{ id: "smart", enabled: false }, { id: "ribbon", enabled: false }] })).status, 500);
  assert.deepEqual(api.settings(), {});
  assert.ok(api.calls.includes("ROLLBACK"));
});

test("inactive templates cannot be used for new cards even by administrators", async () => {
  for (const role of ["user", "admin"]) {
    const api = harness({ template_ribbon_enabled: false });
    const result = await api.call("post", "/", { template: "ribbon", title: "Sample" }, role);
    assert.equal(result.status, 409);
    assert.ok(api.calls.includes("ROLLBACK"));
    assert.ok(!api.calls.some((sql) => sql.includes("INSERT INTO digital_cards(")));
  }
});

test("existing disabled cards can still be edited but switching another card to that template is rejected", async () => {
  const body = { template: "smart", accent_color: "#123456", data: { firstName: "Sample" } };
  const existing = harness({ template_smart_enabled: false });
  assert.equal((await existing.call("put", "/:id", body)).status, 200);
  assert.ok(existing.calls.some((sql) => sql.startsWith("UPDATE digital_cards SET data")));
  const another = harness({ template_smart_enabled: false }, { currentTemplate: "ribbon" });
  assert.equal((await another.call("put", "/:id", body)).status, 409);
  assert.ok(!another.calls.some((sql) => sql.startsWith("UPDATE digital_cards SET data")));
});
