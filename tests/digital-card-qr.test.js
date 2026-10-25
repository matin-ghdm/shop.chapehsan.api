const test = require("node:test");
const assert = require("node:assert/strict");
const { makeQrMatrix, toPng, toSvg } = require("../src/lib/qr-code");

test("QR is a fixed-size matrix for a permanent public card URL", () => {
  const first = makeQrMatrix("https://chapehsan.com/c/Ab8K29");
  const second = makeQrMatrix("https://chapehsan.com/c/Ab8K29");
  assert.equal(first.length, 37);
  assert.ok(first.every((row) => row.length === 37 && row.every((cell) => typeof cell === "boolean")));
  assert.deepEqual(first, second);
});

test("SVG export is vector, includes a four-module quiet zone, and honors color/size", () => {
  const svg = toSvg(makeQrMatrix("https://chapehsan.com/c/Ab8K29"), { color: "#1e4f9c", size: 1024 });
  assert.match(svg, /<svg[^>]+width="1024"[^>]+height="1024"/);
  assert.match(svg, /viewBox="0 0 45 45"/);
  assert.match(svg, /fill="#1e4f9c"/);
});

test("PNG export has a valid PNG signature and requested dimensions", () => {
  const png = toPng(makeQrMatrix("https://chapehsan.com/c/Ab8K29"), { size: 2048 });
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 2048);
  assert.equal(png.readUInt32BE(20), 2048);
});

test("QR rejects links beyond its supported byte capacity and low-contrast ink", () => {
  assert.throws(() => makeQrMatrix(`https://chapehsan.com/c/${"x".repeat(120)}`), /طولانی/);
  assert.throws(() => toSvg(makeQrMatrix("https://chapehsan.com/c/Ab8K29"), { color: "#ffffff" }), /تیره/);
});
