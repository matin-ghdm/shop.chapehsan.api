const assert = require("node:assert/strict");
const { test } = require("node:test");

const calls = [];
let current;
const dbPath = require.resolve("../src/db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT")) return { rows: [current] };
      if (sql.startsWith("INSERT")) {
        current = { id: "product-1", image_path: values[4], image_paths: values[7] };
      } else if (sql.startsWith("UPDATE")) {
        for (const match of sql.matchAll(/(image_path|image_paths) = \$(\d+)/g)) {
          current[match[1]] = values[Number(match[2]) - 1];
        }
      }
      return { rows: [current] };
    },
  },
};

const { createDesign, updateDesign, findById } = require("../src/services/designs");
const payload = { code: "D-065", type: "taslit", title: "محصول", price: 950000, image_path: "/one.jpg" };

test("design image persistence and validation", async (t) => {
  await t.test("stores and retrieves three images with a compatible primary image", async () => {
    const images = ["/one.jpg", "/two.png", "/three.webp"];
    await createDesign({ ...payload, image_paths: images });
    assert.deepEqual((await findById("product-1")).image_paths, images);
    assert.equal(current.image_path, images[0]);
    assert.match(calls.find((call) => call.sql.startsWith("INSERT")).sql, /image_paths/);
    assert.match(calls.at(-1).sql, /SELECT .*image_paths/);
  });

  await t.test("replaces and removes gallery images", async () => {
    await updateDesign("product-1", { image_path: "/two.png", image_paths: ["/two.png", "/replacement.jpg"] });
    assert.equal(current.image_path, "/two.png");
    assert.deepEqual((await findById("product-1")).image_paths, ["/two.png", "/replacement.jpg"]);
  });

  await t.test("keeps secondary images when a legacy client replaces only the primary", async () => {
    await updateDesign("product-1", { image_path: "/new-primary.jpg" });
    assert.deepEqual(current.image_paths, ["/new-primary.jpg", "/replacement.jpg"]);
    await updateDesign("product-1", { title: "عنوان جدید" });
    assert.deepEqual(current.image_paths, ["/new-primary.jpg", "/replacement.jpg"]);
  });

  await t.test("accepts existing single-image requests", async () => {
    await createDesign(payload);
    assert.deepEqual(current.image_paths, ["/one.jpg"]);
  });

  await t.test("rejects more than three images and malformed galleries before writing", async () => {
    for (const image_paths of [["/one.jpg", "/two.jpg", "/three.jpg", "/four.jpg"], "invalid", [null], [""]]) {
      const writes = calls.filter((call) => /^(INSERT|UPDATE)/.test(call.sql)).length;
      await assert.rejects(createDesign({ ...payload, image_paths }), { code: "VALIDATION_ERROR", status: 400 });
      await assert.rejects(updateDesign("product-1", { image_paths }), { code: "VALIDATION_ERROR", status: 400 });
      assert.equal(calls.filter((call) => /^(INSERT|UPDATE)/.test(call.sql)).length, writes);
    }
  });
});
