const { query } = require("../db");
const { normalizeProductOptions } = require("./product-options");

const DESIGN_TYPES = [
  "taslit",
  "stand",
  "hajj",
  "karbala",
  "davati",
  "hamdardi",
  "sarbarg",
  "occasion",
  "laser",
  "decorative",
];

const DESIGN_COLUMNS =
  "id, code, type, category, title, image_path, image_paths, banner_text, product_options, price, is_active, created_at, updated_at";

function bannerText(value) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 5000) {
    throw httpError("متن بنر باید متن و حداکثر ۵۰۰۰ کاراکتر باشد", 400, "VALIDATION_ERROR");
  }
  return value.trim();
}

function designImagePaths(primary, paths) {
  if (paths !== undefined && (!Array.isArray(paths) || paths.some((path) => typeof path !== "string" || !path.trim()))) {
    throw httpError("image_paths باید آرایه‌ای از آدرس تصاویر باشد", 400, "VALIDATION_ERROR");
  }
  const images = [...new Set([String(primary).trim(), ...(paths || []).map((path) => path.trim())])];
  if (!images[0] || images.length > 3 || (paths && paths.length > 3)) {
    throw httpError("هر محصول باید بین یک تا سه تصویر داشته باشد", 400, "VALIDATION_ERROR");
  }
  return images;
}

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function invalidTypeError(type) {
  const received = type === undefined || type === null || type === "" ? "خالی" : String(type);
  return httpError(
    `فیلد «نوع محصول» نامعتبر است. مقدار دریافت‌شده: «${received}». مقادیر مجاز: ${DESIGN_TYPES.join(", ")}`,
    400,
    "INVALID_TYPE"
  );
}

async function findById(id) {
  const result = await query(
    `SELECT ${DESIGN_COLUMNS} FROM designs WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByCode(code, type = null) {
  // code is unique only together with (type, code) in DB.
  // If type is not provided, we return the latest matching design by code.
  if (!code) return null;

  if (type) {
    const result = await query(
      `SELECT ${DESIGN_COLUMNS}
       FROM designs
       WHERE code = $1 AND type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [code, type]
    );
    return result.rows[0] || null;
  }

  const result = await query(
    `SELECT ${DESIGN_COLUMNS}
     FROM designs
     WHERE code = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [code]
  );
  return result.rows[0] || null;
}

async function listDesigns({
  type = null,
  category = null,
  activeOnly = false,
} = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (type) {
    if (!DESIGN_TYPES.includes(type)) {
      throw invalidTypeError(type);
    }
    conditions.push(`type = $${i++}`);
    values.push(type);
  }

  if (category) {
    conditions.push(`category = $${i++}`);
    values.push(category);
  }

  if (activeOnly) {
    conditions.push("is_active = TRUE");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await query(
    `SELECT ${DESIGN_COLUMNS},
       COALESCE((SELECT SUM(oi.quantity) FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.design_id = designs.id AND o.status <> 'canceled'
           AND (o.paid_at IS NOT NULL OR o.status = 'paid')), 0) AS sales_count
     FROM designs
     ${where}
     ORDER BY created_at DESC`,
    values
  );
  return result.rows;
}

async function createDesign(payload) {
  if (!payload.code || !payload.type || !payload.title || !payload.image_path) {
    throw httpError(
      "فیلدهای code، type، title و image_path الزامی هستند",
      400,
      "VALIDATION_ERROR"
    );
  }
  if (!DESIGN_TYPES.includes(payload.type)) {
    throw invalidTypeError(payload.type);
  }

  const price =
    payload.price !== undefined && payload.price !== null
      ? Number(payload.price)
      : null;
  if (price === null || !Number.isInteger(price) || price < 0) {
    throw httpError("price باید عدد صحیح غیرمنفی باشد", 400, "VALIDATION_ERROR");
  }

  try {
    const images = designImagePaths(payload.image_path, payload.image_paths);
    const result = await query(
      `INSERT INTO designs
         (code, type, category, title, image_path, price, is_active, image_paths, banner_text, product_options)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING ${DESIGN_COLUMNS}`,
      [
        String(payload.code).trim(),
        payload.type,
        payload.category || null,
        String(payload.title).trim(),
        String(payload.image_path).trim(),
        price,
        payload.is_active !== undefined ? Boolean(payload.is_active) : true,
        images,
        bannerText(payload.banner_text),
        JSON.stringify(normalizeProductOptions(payload.product_options)),
      ]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === "23505") {
      throw httpError(
        "این code برای این type قبلاً ثبت شده است",
        409,
        "DUPLICATE_CODE"
      );
    }
    throw err;
  }
}

async function updateDesign(id, payload) {
  const current = await findById(id);
  if (!current) {
    throw httpError("طرح پیدا نشد", 404, "NOT_FOUND");
  }

  if (payload.type !== undefined && !DESIGN_TYPES.includes(payload.type)) {
    throw invalidTypeError(payload.type);
  }

  const fields = [];
  const values = [];
  let i = 1;

  if (payload.product_options !== undefined) {
    fields.push(`product_options = $${i++}::jsonb`);
    values.push(JSON.stringify(normalizeProductOptions(payload.product_options)));
  }

  if (payload.code !== undefined) {
    if (!payload.code) {
      throw httpError("code نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`code = $${i++}`);
    values.push(String(payload.code).trim());
  }
  if (payload.type !== undefined) {
    fields.push(`type = $${i++}`);
    values.push(payload.type);
  }
  if (payload.category !== undefined) {
    fields.push(`category = $${i++}`);
    values.push(payload.category || null);
  }
  if (payload.title !== undefined) {
    if (!payload.title) {
      throw httpError("title نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`title = $${i++}`);
    values.push(String(payload.title).trim());
  }
  if (payload.image_path !== undefined) {
    if (!payload.image_path) {
      throw httpError("image_path نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`image_path = $${i++}`);
    values.push(String(payload.image_path).trim());
  }
  if (payload.image_paths !== undefined || payload.image_path !== undefined) {
    const images = designImagePaths(
      payload.image_path ?? current.image_path,
      payload.image_paths ?? (current.image_paths || []).slice(1)
    );
    fields.push(`image_paths = $${i++}`);
    values.push(images);
  }
  if (payload.price !== undefined) {
    const price = Number(payload.price);
    if (!Number.isInteger(price) || price < 0) {
      throw httpError("price معتبر نیست", 400, "VALIDATION_ERROR");
    }
    fields.push(`price = $${i++}`);
    values.push(price);
  }
  if (payload.banner_text !== undefined) {
    fields.push(`banner_text = $${i++}`);
    values.push(bannerText(payload.banner_text));
  }
  if (payload.is_active !== undefined) {
    fields.push(`is_active = $${i++}`);
    values.push(Boolean(payload.is_active));
  }

  if (fields.length === 0) {
    throw httpError("هیچ فیلدی برای بروزرسانی ارسال نشده", 400, "NO_FIELDS");
  }

  values.push(id);
  try {
    const result = await query(
      `UPDATE designs SET ${fields.join(", ")}, updated_at = NOW()
       WHERE id = $${i}
       RETURNING ${DESIGN_COLUMNS}`,
      values
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === "23505") {
      throw httpError(
        "این code برای این type قبلاً ثبت شده است",
        409,
        "DUPLICATE_CODE"
      );
    }
    throw err;
  }
}

async function deleteDesign(id) {
  const result = await query(
    `DELETE FROM designs WHERE id = $1 RETURNING ${DESIGN_COLUMNS}`,
    [id]
  );
  if (!result.rows[0]) {
    throw httpError("طرح پیدا نشد", 404, "NOT_FOUND");
  }
  return result.rows[0];
}

async function updatePriceByType(type, price) {
  if (!DESIGN_TYPES.includes(type)) {
    throw invalidTypeError(type);
  }
  if (type === "occasion") {
    const configured = await query("SELECT 1 FROM designs WHERE type = $1 AND jsonb_array_length(product_options->'variants') > 0 LIMIT 1", [type]);
    if (configured.rows.length) throw httpError("برای محصولات مناسبتی دارای چند نوع، قیمت هر نوع را در ویرایش محصول تغییر دهید", 400, "VARIANT_PRICES_REQUIRED");
  }

  const newPrice = Number(price);
  if (!Number.isInteger(newPrice) || newPrice < 0) {
    throw httpError("price باید عدد صحیح غیرمنفی باشد", 400, "VALIDATION_ERROR");
  }

  const result = await query(
    `UPDATE designs SET price = $1, updated_at = NOW()
     WHERE type = $2
     RETURNING ${DESIGN_COLUMNS}`,
    [newPrice, type]
  );

  if (result.rowCount === 0) {
    throw httpError("طرحی با این type پیدا نشد", 404, "NOT_FOUND");
  }

  return {
    type,
    price: newPrice,
    updated_count: result.rowCount,
    designs: result.rows,
  };
}

module.exports = {
  DESIGN_TYPES,
  findById,
  findByCode,
  listDesigns,
  createDesign,
  updateDesign,
  updatePriceByType,
  deleteDesign,
};
