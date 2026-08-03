const { query } = require("../db");

const PLACEMENTS = ["home", "design"];

const SLIDE_COLUMNS =
  "id, placement, image_path, alt, title, caption, link, sort_order, is_active, created_at";

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function findById(id) {
  const result = await query(
    `SELECT ${SLIDE_COLUMNS} FROM slides WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function listSlides({
  placement = null,
  activeOnly = false,
} = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (placement) {
    if (!PLACEMENTS.includes(placement)) {
      throw httpError("placement نامعتبر است", 400, "INVALID_PLACEMENT");
    }
    conditions.push(`placement = $${i++}`);
    values.push(placement);
  }

  if (activeOnly) {
    conditions.push("is_active = TRUE");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await query(
    `SELECT ${SLIDE_COLUMNS}
     FROM slides
     ${where}
     ORDER BY sort_order ASC, created_at DESC`,
    values
  );
  return result.rows;
}

async function createSlide(payload) {
  const placement = payload.placement || "home";
  if (!PLACEMENTS.includes(placement)) {
    throw httpError("placement باید home یا design باشد", 400, "INVALID_PLACEMENT");
  }
  if (!payload.image_path || !payload.alt) {
    throw httpError("image_path و alt الزامی هستند", 400, "VALIDATION_ERROR");
  }

  const sortOrder =
    payload.sort_order !== undefined ? Number(payload.sort_order) : 0;
  if (!Number.isInteger(sortOrder)) {
    throw httpError("sort_order باید عدد صحیح باشد", 400, "VALIDATION_ERROR");
  }

  const result = await query(
    `INSERT INTO slides
       (placement, image_path, alt, title, caption, link, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SLIDE_COLUMNS}`,
    [
      placement,
      String(payload.image_path).trim(),
      String(payload.alt).trim(),
      payload.title || null,
      payload.caption || null,
      payload.link || null,
      sortOrder,
      payload.is_active !== undefined ? Boolean(payload.is_active) : true,
    ]
  );
  return result.rows[0];
}

async function updateSlide(id, payload) {
  const current = await findById(id);
  if (!current) {
    throw httpError("اسلاید پیدا نشد", 404, "NOT_FOUND");
  }

  if (payload.placement !== undefined && !PLACEMENTS.includes(payload.placement)) {
    throw httpError("placement باید home یا design باشد", 400, "INVALID_PLACEMENT");
  }

  const fields = [];
  const values = [];
  let i = 1;

  if (payload.placement !== undefined) {
    fields.push(`placement = $${i++}`);
    values.push(payload.placement);
  }
  if (payload.image_path !== undefined) {
    if (!payload.image_path) {
      throw httpError("image_path نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`image_path = $${i++}`);
    values.push(String(payload.image_path).trim());
  }
  if (payload.alt !== undefined) {
    if (!payload.alt) {
      throw httpError("alt نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`alt = $${i++}`);
    values.push(String(payload.alt).trim());
  }
  if (payload.title !== undefined) {
    fields.push(`title = $${i++}`);
    values.push(payload.title || null);
  }
  if (payload.caption !== undefined) {
    fields.push(`caption = $${i++}`);
    values.push(payload.caption || null);
  }
  if (payload.link !== undefined) {
    fields.push(`link = $${i++}`);
    values.push(payload.link || null);
  }
  if (payload.sort_order !== undefined) {
    const sortOrder = Number(payload.sort_order);
    if (!Number.isInteger(sortOrder)) {
      throw httpError("sort_order باید عدد صحیح باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`sort_order = $${i++}`);
    values.push(sortOrder);
  }
  if (payload.is_active !== undefined) {
    fields.push(`is_active = $${i++}`);
    values.push(Boolean(payload.is_active));
  }

  if (fields.length === 0) {
    throw httpError("هیچ فیلدی برای بروزرسانی ارسال نشده", 400, "NO_FIELDS");
  }

  values.push(id);
  const result = await query(
    `UPDATE slides SET ${fields.join(", ")}
     WHERE id = $${i}
     RETURNING ${SLIDE_COLUMNS}`,
    values
  );
  return result.rows[0];
}

async function deleteSlide(id) {
  const result = await query(
    `DELETE FROM slides WHERE id = $1 RETURNING ${SLIDE_COLUMNS}`,
    [id]
  );
  if (!result.rows[0]) {
    throw httpError("اسلاید پیدا نشد", 404, "NOT_FOUND");
  }
  return result.rows[0];
}

module.exports = {
  PLACEMENTS,
  findById,
  listSlides,
  createSlide,
  updateSlide,
  deleteSlide,
};
