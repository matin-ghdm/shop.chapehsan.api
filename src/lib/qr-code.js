const zlib = require("zlib");
const QRCode = require("qrcode");

function makeQrMatrix(text) {
  const { size, data } = QRCode.create(String(text), { errorCorrectionLevel: "M" }).modules;
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => data[row * size + column] === 1));
}

function normalizeColor(value) {
  const color = String(value || "#000000").trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    const error = new Error("رنگ QR معتبر نیست");
    error.status = 400;
    throw error;
  }
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const luminance = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  if (luminance > 0.183) {
    const error = new Error("برای کنتراست مناسب و اسکن مطمئن، رنگ QR باید تیره باشد");
    error.status = 400;
    throw error;
  }
  return color.toLowerCase();
}

function toSvg(matrix, { color = "#000000", size = 512, transparent = false } = {}) {
  const fill = normalizeColor(color);
  const dimensionPx = Math.max(128, Math.min(4096, Math.round(Number(size) || 512)));
  const quiet = 4;
  const dimension = matrix.length + quiet * 2;
  const paths = [];
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) paths.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
  }));
  const background = transparent ? "" : '<rect width="100%" height="100%" fill="#fff"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensionPx}" height="${dimensionPx}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">${background}<path fill="${fill}" d="${paths.join("")}"/></svg>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function toPng(matrix, { color = "#000000", size = 512, transparent = false } = {}) {
  const ink = normalizeColor(color);
  const width = Math.max(128, Math.min(4096, Math.round(Number(size) || 512)));
  const quiet = 4;
  const modules = matrix.length + quiet * 2;
  const scale = Math.floor(width / modules);
  const offset = Math.floor((width - scale * modules) / 2);
  const rgb = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * width);
  for (let y = 0; y < width; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0; // PNG filter: None.
    for (let x = 0; x < width; x += 1) {
      const mx = Math.floor((x - offset) / scale) - quiet;
      const my = Math.floor((y - offset) / scale) - quiet;
      const inSymbol = mx >= 0 && my >= 0 && mx < matrix.length && my < matrix.length;
      const dark = inSymbol && matrix[my][mx];
      const p = row + 1 + x * 4;
      if (dark) {
        raw[p] = rgb[0]; raw[p + 1] = rgb[1]; raw[p + 2] = rgb[2]; raw[p + 3] = 255;
      } else if (!transparent) {
        raw[p] = 255; raw[p + 1] = 255; raw[p + 2] = 255; raw[p + 3] = 255;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(width, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA.
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

module.exports = { makeQrMatrix, toSvg, toPng, normalizeColor };
