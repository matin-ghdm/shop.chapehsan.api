const { query } = require("../db");

const DOWNLOAD_TYPES = ["layer", "pdf", "map", "other"];

const DOWNLOAD_COLUMNS =
  "id, name, description, type, file_path, format, is_protected, uploaded_at";

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function toPublicDownload(row, { hideFilePath = false } = {}) {
  if (!row) return null;
  const item = {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    format: row.format,
    is_protected: row.is_protected,
    uploaded_at: row.uploaded_at,
  };
  if (!hideFilePath) {
    item.file_path = row.file_path;
  }
  return item;
}

async function findById(id) {
  const result = await query(
    `SELECT ${DOWNLOAD_COLUMNS} FROM downloads WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function listDownloads({ type = null, protectedOnly = null } = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

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

async function createDownload(payload) {
  if (!payload.name || !payload.type || !payload.file_path) {
    throw httpError(
      "فیلدهای name، type و file_path الزامی هستند",
      400,
      "VALIDATION_ERROR"
    );
  }
  if (!DOWNLOAD_TYPES.includes(payload.type)) {
    throw httpError(
      "type باید یکی از layer، pdf، map، other باشد",
      400,
      "INVALID_TYPE"
    );
  }

  const result = await query(
    `INSERT INTO downloads
       (name, description, type, file_path, format, is_protected)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${DOWNLOAD_COLUMNS}`,
    [
      String(payload.name).trim(),
      payload.description || null,
      payload.type,
      String(payload.file_path).trim(),
      payload.format || null,
      payload.is_protected !== undefined ? Boolean(payload.is_protected) : false,
    ]
  );
  return result.rows[0];
}

async function updateDownload(id, payload) {
  const current = await findById(id);
  if (!current) {
    throw httpError("دانلود پیدا نشد", 404, "NOT_FOUND");
  }

  if (payload.type !== undefined && !DOWNLOAD_TYPES.includes(payload.type)) {
    throw httpError(
      "type باید یکی از layer، pdf، map، other باشد",
      400,
      "INVALID_TYPE"
    );
  }

  const fields = [];
  const values = [];
  let i = 1;

  if (payload.name !== undefined) {
    if (!payload.name) {
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
    if (!payload.file_path) {
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

  if (fields.length === 0) {
    throw httpError("هیچ فیلدی برای بروزرسانی ارسال نشده", 400, "NO_FIELDS");
  }

  values.push(id);
  const result = await query(
    `UPDATE downloads SET ${fields.join(", ")}
     WHERE id = $${i}
     RETURNING ${DOWNLOAD_COLUMNS}`,
    values
  );
  return result.rows[0];
}

async function deleteDownload(id) {
  const result = await query(
    `DELETE FROM downloads WHERE id = $1 RETURNING ${DOWNLOAD_COLUMNS}`,
    [id]
  );
  if (!result.rows[0]) {
    throw httpError("دانلود پیدا نشد", 404, "NOT_FOUND");
  }
  return result.rows[0];
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
