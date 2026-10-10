const { query } = require("../db");

const DOWNLOAD_TYPES = ["layer", "pdf", "image", "banner", "tasliat", "map", "other"];

const DOWNLOAD_COLUMNS =
  "id, name, description, type, file_path, format, is_protected, uploaded_at, is_active, requires_login, archive_password, preview_path, size_bytes, download_count, updated_at, dimensions, software, usage_guide, usage_terms, is_paid, price, file_key, file_source";

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function toPublicDownload(row, { hideFilePath = false, includeSource = false } = {}) {
  if (!row) return null;
  const item = {
    id: row.id, is_paid: row.is_paid, price: Number(row.price || 0), secured: Boolean(row.file_key),
    name: row.name,
    description: row.description,
    type: row.type,
    format: row.format,
    is_protected: row.is_protected,
    uploaded_at: row.uploaded_at,
    is_active: row.is_active, requires_login: row.requires_login, archive_password: row.archive_password,
    preview_path: row.preview_path, size_bytes: row.size_bytes, download_count: Number(row.download_count), updated_at: row.updated_at,
    dimensions: row.dimensions, software: row.software, usage_guide: row.usage_guide, usage_terms: row.usage_terms,
  };
  if (!hideFilePath) {
    item.file_path = row.file_path;
  }
  if (includeSource) item.file_source = row.file_source;
  return item;
}

async function findById(id) {
  const result = await query(
    `SELECT ${DOWNLOAD_COLUMNS} FROM downloads WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function listDownloads({ type = null, protectedOnly = null, includeInactive = false } = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (!includeInactive) conditions.push("is_active = TRUE");
  if (type) {
    if (!DOWNLOAD_TYPES.includes(type)) {
      throw httpError("type نامعتبر است", 400, "INVALID_TYPE");
    }
    conditions.push(`type = $${i++}`);
    values.push(type);
  }

  if (protectedOnly === true) {
    conditions.push("is_protected = TRUE");
  } else if (protectedOnly === false) {
    conditions.push("is_protected = FALSE");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await query(
    `SELECT ${DOWNLOAD_COLUMNS}
     FROM downloads
     ${where}
     ORDER BY uploaded_at DESC`,
    values
  );
  return result.rows;
}

function validateMetadata(payload) {
  for (const key of ["is_active", "requires_login", "is_protected"]) {
    if (payload[key] !== undefined && typeof payload[key] !== "boolean") throw httpError("وضعیت نامعتبر است");
  }
  if (payload.size_bytes != null && (!Number.isSafeInteger(Number(payload.size_bytes)) || Number(payload.size_bytes) < 0)) throw httpError("حجم نامعتبر است");
}
function validatePricing(payload, current = {}) {
  const next = {...current, ...payload};
  if (payload.is_paid !== undefined && typeof payload.is_paid !== 'boolean') throw httpError('نوع فروش نامعتبر است');
  if (payload.price !== undefined && (!Number.isSafeInteger(Number(payload.price)) || Number(payload.price)<0)) throw httpError('قیمت نامعتبر است');
  if (next.is_paid && Number(next.price)<100) throw httpError('قیمت فایل پولی باید حداقل ۱۰۰ تومان باشد');
  if (next.is_paid && !/^[a-f0-9]{64}$/.test(next.file_key || '')) throw httpError('فایل پولی باید از طریق آپلود امن ذخیره شود');
  if (payload.file_path !== undefined && current.file_key && payload.file_path !== current.file_path && payload.file_key === undefined) throw httpError('فایل جایگزین باید دوباره به صورت امن ذخیره شود');
  if (payload.file_key !== undefined && !/^[a-f0-9]{64}$/.test(payload.file_key)) throw httpError('کلید فایل نامعتبر است');
}
function validateLinks(payload) {
  for (const key of ["file_path", "preview_path"]) {
    if (!payload[key]) continue;
    const value = String(payload[key]).trim();
    if (!( /^https?:\/\/[^\s]+$/i.test(value) || /^\/(?![\/\\])[^\s\\]+$/.test(value) )) throw httpError("آدرس فایل یا تصویر نامعتبر است");
  }
}

async function createDownload(payload) {
  validateLinks(payload);
  if (!String(payload.name || "").trim() || !payload.type || !String(payload.file_path || "").trim()) {
    throw httpError(
      "فیلدهای name، type و file_path الزامی هستند",
      400,
      "VALIDATION_ERROR"
    );
  }
  if (!DOWNLOAD_TYPES.includes(payload.type)) {
    throw httpError(
      "دسته‌بندی فایل نامعتبر است",
      400,
      "INVALID_TYPE"
    );
  }

  validateMetadata(payload); validatePricing(payload);
  const result = await query(
    `INSERT INTO downloads (name,description,type,file_path,format,is_protected,is_active,requires_login,archive_password,preview_path,size_bytes,dimensions,software,usage_guide,usage_terms,is_paid,price,file_key,file_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING ${DOWNLOAD_COLUMNS}`,
    [String(payload.name).trim(), payload.description || null, payload.type, String(payload.file_path).trim(), payload.format || null,
     Boolean(payload.is_protected), payload.is_active !== false, payload.requires_login === true,
     String(payload.archive_password || "").trim() || null, String(payload.preview_path || "").trim() || null, payload.size_bytes ?? null, ...["dimensions", "software", "usage_guide", "usage_terms"].map(key => String(payload[key] || "").trim() || null), payload.is_paid === true, payload.is_paid ? Number(payload.price) : 0, payload.file_key || null, payload.file_source || null]
  );
  return toPublicDownload(result.rows[0]);
}

async function updateDownload(id, payload) {
  validateLinks(payload); validateMetadata(payload);
  const current = await findById(id);
  if (!current) {
    throw httpError("دانلود پیدا نشد", 404, "NOT_FOUND");
  }

  validatePricing(payload, current);
  if (payload.type !== undefined && !DOWNLOAD_TYPES.includes(payload.type)) {
    throw httpError(
      "دسته‌بندی فایل نامعتبر است",
      400,
      "INVALID_TYPE"
    );
  }

  const fields = [];
  const values = [];
  let i = 1;

  if (payload.name !== undefined) {
    if (!String(payload.name || "").trim()) {
      throw httpError("name نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`name = $${i++}`);
    values.push(String(payload.name).trim());
  }
  if (payload.description !== undefined) {
    fields.push(`description = $${i++}`);
    values.push(payload.description || null);
  }
  if (payload.type !== undefined) {
    fields.push(`type = $${i++}`);
    values.push(payload.type);
  }
  if (payload.file_path !== undefined) {
    if (!String(payload.file_path || "").trim()) {
      throw httpError("file_path نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`file_path = $${i++}`);
    values.push(String(payload.file_path).trim());
  }
  if (payload.format !== undefined) {
    fields.push(`format = $${i++}`);
    values.push(payload.format || null);
  }
  if (payload.is_protected !== undefined) {
    fields.push(`is_protected = $${i++}`);
    values.push(Boolean(payload.is_protected));
  }

  for (const key of ["is_active", "requires_login", "archive_password", "preview_path", "size_bytes", "dimensions", "software", "usage_guide", "usage_terms", "is_paid", "price", "file_key", "file_source"]) {
    if (payload[key] === undefined) continue;
    let value = payload[key];
    if (["is_active", "requires_login", "is_paid"].includes(key)) {
      if (typeof value !== "boolean") throw httpError("وضعیت نامعتبر است");
    } else if (key === "price") { value = Number(value);
    } else if (key === "size_bytes") {
      if (value !== null && (!Number.isSafeInteger(Number(value)) || Number(value) < 0)) throw httpError("حجم نامعتبر است");
      value = value === null ? null : Number(value);
    } else value = String(value || "").trim() || null;
    fields.push(`${key} = $${i++}`); values.push(value);
  }
  if (fields.length === 0) {
    throw httpError("هیچ فیلدی برای بروزرسانی ارسال نشده", 400, "NO_FIELDS");
  }

  values.push(id);
  const result = await query(
    `UPDATE downloads SET updated_at = NOW(), ${fields.join(", ")}
     WHERE id = $${i}
     RETURNING ${DOWNLOAD_COLUMNS}`,
    values
  );
  return toPublicDownload(result.rows[0]);
}

async function deleteDownload(id) {
  const result = await query(
    `DELETE FROM downloads WHERE id = $1 RETURNING ${DOWNLOAD_COLUMNS}`,
    [id]
  );
  if (!result.rows[0]) {
    throw httpError("دانلود پیدا نشد", 404, "NOT_FOUND");
  }
  return toPublicDownload(result.rows[0]);
}

module.exports = {
  DOWNLOAD_TYPES,
  findById,
  listDownloads,
  createDownload,
  updateDownload,
  deleteDownload,
  toPublicDownload,
};
