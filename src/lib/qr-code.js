const zlib = require("zlib");

const QR_SIZE = 37; // Version 5-L: one block, 108 data codewords, 26 ECC.
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomon(data) {
  let generator = [1];
  let root = 1;
  for (let i = 0; i < ECC_CODEWORDS; i += 1) {
    const next = Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j += 1) {
      next[j] ^= generator[j];
      next[j + 1] ^= gfMultiply(generator[j], root);
    }
    generator = next;
    root = gfMultiply(root, 2);
  }
  const remainder = Array(ECC_CODEWORDS).fill(0);
  for (const value of data) {
    const factor = value ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ECC_CODEWORDS; i += 1) {
      remainder[i] ^= gfMultiply(generator[i + 1], factor);
    }
  }
  return remainder;
}

function appendBits(target, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) target.push((value >>> i) & 1);
}

function formatBits(mask) {
  const value = (1 << 3) | mask; // Error correction level L is binary 01.
  let remainder = value << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((remainder >>> i) & 1) remainder ^= 0x537 << (i - 10);
  }
  return ((value << 10) | remainder) ^ 0x5412;
}

function makeQrMatrix(text) {
  const bytes = Buffer.from(String(text), "utf8");
  if (!bytes.length || bytes.length > 106) {
    const error = new Error("پیوند کارت برای ساخت QR بیش از حد طولانی است");
    error.status = 400;
    throw error;
  }

  const bits = [];
  appendBits(bits, 0b0100, 4); // Byte mode.
  appendBits(bits, bytes.length, 8); // Versions 1–9 use an 8-bit byte count.
  for (const byte of bytes) appendBits(bits, byte, 8);
  const capacity = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (const pad of [0xec, 0x11]) {
    if (data.length >= DATA_CODEWORDS) break;
    data.push(pad);
  }
  let padIndex = 0;
  while (data.length < DATA_CODEWORDS) {
    data.push(padIndex++ % 2 === 0 ? 0xec : 0x11);
  }
  const codewords = [...data, ...reedSolomon(data)];
  const matrix = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(false));
  const reserved = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(false));
  const setFunction = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) return;
    matrix[y][x] = Boolean(dark);
    reserved[y][x] = true;
  };

  function finder(cx, cy) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, distance <= 3 && distance !== 2);
      }
    }
  }
  finder(3, 3);
  finder(QR_SIZE - 4, 3);
  finder(3, QR_SIZE - 4);

  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    if (!reserved[6][i]) setFunction(i, 6, i % 2 === 0);
    if (!reserved[i][6]) setFunction(6, i, i % 2 === 0);
  }

  const center = QR_SIZE - 7;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(center + dx, center + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // Reserve the two format-information copies and the fixed dark module.
  for (let i = 0; i < 15; i += 1) {
    if (i < 6) setFunction(8, i, false);
    else if (i < 8) setFunction(8, i + 1, false);
    else setFunction(14 - i, 8, false);

    if (i < 8) setFunction(QR_SIZE - 1 - i, 8, false);
    else setFunction(8, QR_SIZE - 15 + i, false);
  }
  setFunction(8, QR_SIZE - 8, true);

  let bitIndex = 0;
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (reserved[y][x]) continue;
        const bit = bitIndex < codewords.length * 8
          ? (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1
          : 0;
        bitIndex += 1;
        matrix[y][x] = Boolean(bit ^ (((x + y) % 2 === 0) ? 1 : 0)); // Mask 0.
      }
    }
  }

  const format = formatBits(0);
  for (let i = 0; i < 15; i += 1) {
    const bit = ((format >>> i) & 1) !== 0;
    if (i < 6) matrix[i][8] = bit;
    else if (i < 8) matrix[i + 1][8] = bit;
    else matrix[8][14 - i] = bit;

    if (i < 8) matrix[8][QR_SIZE - 1 - i] = bit;
    else matrix[QR_SIZE - 15 + i][8] = bit;
  }
  return matrix;
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
