const { query } = require("../db");

const ADDRESS_COLUMNS =
  "id, user_id, title, province, city, address, postal_code, phone, created_at";

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function findById(id) {
  const result = await query(
    `SELECT ${ADDRESS_COLUMNS} FROM addresses WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function listAddresses({ userId = null } = {}) {
  if (userId) {
    const result = await query(
      `SELECT ${ADDRESS_COLUMNS}
       FROM addresses
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  const result = await query(
    `SELECT ${ADDRESS_COLUMNS}
     FROM addresses
     ORDER BY created_at DESC`
  );
  return result.rows;
}

function assertAddressAccess(address, currentUser) {
  if (!address) {
    throw httpError("آدرس پیدا نشد", 404, "NOT_FOUND");
  }
  if (currentUser.role !== "admin" && address.user_id !== currentUser.id) {
    throw httpError("دسترسی غیرمجاز", 403, "FORBIDDEN");
  }
}

async function createAddress(payload, currentUser) {
  const userId =
    currentUser.role === "admin" && payload.user_id
      ? payload.user_id
      : currentUser.id;

  const province = payload.province;
  const city = payload.city;
  const address = payload.address;

  if (!province || !city || !address) {
    throw httpError(
      "فیلدهای province، city و address الزامی هستند",
      400,
      "VALIDATION_ERROR"
    );
  }

  try {
    const result = await query(
      `INSERT INTO addresses
         (user_id, title, province, city, address, postal_code, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${ADDRESS_COLUMNS}`,
      [
        userId,
        payload.title || null,
        String(province).trim(),
        String(city).trim(),
        String(address).trim(),
        payload.postal_code || null,
        payload.phone || null,
      ]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === "23503") {
      throw httpError("user_id نامعتبر است", 400, "FK_ERROR");
    }
    throw err;
  }
}

async function updateAddress(id, payload, currentUser) {
  const current = await findById(id);
  assertAddressAccess(current, currentUser);

  const fields = [];
  const values = [];
  let i = 1;

  if (payload.title !== undefined) {
    fields.push(`title = $${i++}`);
    values.push(payload.title || null);
  }
  if (payload.province !== undefined) {
    if (!payload.province) {
      throw httpError("province نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`province = $${i++}`);
    values.push(String(payload.province).trim());
  }
  if (payload.city !== undefined) {
    if (!payload.city) {
      throw httpError("city نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`city = $${i++}`);
    values.push(String(payload.city).trim());
  }
  if (payload.address !== undefined) {
    if (!payload.address) {
      throw httpError("address نمی‌تواند خالی باشد", 400, "VALIDATION_ERROR");
    }
    fields.push(`address = $${i++}`);
    values.push(String(payload.address).trim());
  }
  if (payload.postal_code !== undefined) {
    fields.push(`postal_code = $${i++}`);
    values.push(payload.postal_code || null);
  }
  if (payload.phone !== undefined) {
    fields.push(`phone = $${i++}`);
    values.push(payload.phone || null);
  }

  if (fields.length === 0) {
    throw httpError("هیچ فیلدی برای بروزرسانی ارسال نشده", 400, "NO_FIELDS");
  }

  values.push(id);
  const result = await query(
    `UPDATE addresses SET ${fields.join(", ")}
     WHERE id = $${i}
     RETURNING ${ADDRESS_COLUMNS}`,
    values
  );
  return result.rows[0];
}

async function deleteAddress(id, currentUser) {
  const current = await findById(id);
  assertAddressAccess(current, currentUser);

  const result = await query(
    `DELETE FROM addresses WHERE id = $1 RETURNING ${ADDRESS_COLUMNS}`,
    [id]
  );
  return result.rows[0];
}

module.exports = {
  findById,
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  assertAddressAccess,
};
