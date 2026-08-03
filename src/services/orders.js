const { pool, query } = require("../db");

const ORDER_STATUSES = [
  "pending",
  "awaiting_payment",
  "paid",
  "confirmed",
  "printing",
  "ready",
  "delivered",
  "canceled",
];

const ORDER_COLUMNS =
  "id, user_id, address_id, is_pickup, status, total_price, note, created_at";

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function getItemsByOrderId(orderId, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    `SELECT id, order_id, design_id, quantity, unit_price, custom_data, item_note
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [orderId]
  );
  return result.rows;
}

async function findById(id) {
  const result = await query(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function getOrderWithItems(id) {
  const order = await findById(id);
  if (!order) return null;
  const items = await getItemsByOrderId(id);
  return { ...order, items };
}

async function listOrders({ userId = null, status = null } = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (userId) {
    conditions.push(`user_id = $${i++}`);
    values.push(userId);
  }
  if (status) {
    conditions.push(`status = $${i++}`);
    values.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await query(
    `SELECT ${ORDER_COLUMNS}
     FROM orders
     ${where}
     ORDER BY created_at DESC`,
    values
  );
  return result.rows;
}

function validateAddressRule(isPickup, addressId) {
  if (!isPickup && !addressId) {
    throw httpError(
      "برای سفارش غیرحضوری address_id الزامی است",
      400,
      "ADDRESS_REQUIRED"
    );
  }
}

async function resolveDesignId(client, item) {
  if (item.design_id) return item.design_id;

  const code = String(item.design_code || item.custom_data?.code || "").trim();
  const type = String(item.design_type || item.custom_data?.design_type || "").trim();
  const title = String(item.custom_data?.title || code || "طرح").trim();
  const imagePath = item.custom_data?.image || null;
  const price = Number(item.unit_price ?? item.custom_data?.price ?? 0);

  if (!code || !type) {
    throw httpError(
      "برای هر آیتم design_id یا (design_code و design_type) الزامی است",
      400,
      "VALIDATION_ERROR"
    );
  }

  const existing = await client.query(
    `SELECT id FROM designs WHERE code = $1 AND type = $2 LIMIT 1`,
    [code, type]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  try {
    const created = await client.query(
      `INSERT INTO designs (code, type, title, image_path, price, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id`,
      [code, type, title, imagePath, Number.isInteger(price) ? price : 0]
    );
    return created.rows[0].id;
  } catch (err) {
    if (err.code === "23505") {
      const again = await client.query(
        `SELECT id FROM designs WHERE code = $1 AND type = $2 LIMIT 1`,
        [code, type]
      );
      if (again.rows[0]) return again.rows[0].id;
    }
    throw err;
  }
}

async function insertItems(client, orderId, items) {
  const inserted = [];
  for (const item of items) {
    const designId = await resolveDesignId(client, item);

    if (item.unit_price === undefined || item.unit_price === null) {
      throw httpError("unit_price برای آیتم الزامی است", 400, "VALIDATION_ERROR");
    }
    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.unit_price);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw httpError("quantity باید عدد صحیح بزرگ‌تر از صفر باشد", 400, "VALIDATION_ERROR");
    }
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      throw httpError("unit_price باید عدد صحیح غیرمنفی باشد", 400, "VALIDATION_ERROR");
    }

    const result = await client.query(
      `INSERT INTO order_items
         (order_id, design_id, quantity, unit_price, custom_data, item_note)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, order_id, design_id, quantity, unit_price, custom_data, item_note`,
      [
        orderId,
        designId,
        quantity,
        unitPrice,
        JSON.stringify(item.custom_data || {}),
        item.item_note || null,
      ]
    );
    inserted.push(result.rows[0]);
  }
  return inserted;
}

function calcTotalFromItems(items) {
  return items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unit_price),
    0
  );
}

async function createOrder(payload, currentUser) {
  const userId =
    currentUser.role === "admin" && payload.user_id
      ? payload.user_id
      : currentUser.id;

  const isPickup = Boolean(payload.is_pickup);
  const addressId = payload.address_id || null;
  validateAddressRule(isPickup, addressId);

  const items = Array.isArray(payload.items) ? payload.items : [];
  let totalPrice =
    payload.total_price !== undefined && payload.total_price !== null
      ? Number(payload.total_price)
      : null;

  if (items.length > 0 && (totalPrice === null || Number.isNaN(totalPrice))) {
    totalPrice = calcTotalFromItems(items);
  }

  if (totalPrice === null || Number.isNaN(totalPrice) || totalPrice < 0) {
    throw httpError("total_price معتبر نیست", 400, "VALIDATION_ERROR");
  }

  const status = payload.status || "awaiting_payment";
  if (!ORDER_STATUSES.includes(status)) {
    throw httpError("status نامعتبر است", 400, "INVALID_STATUS");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `INSERT INTO orders
         (user_id, address_id, is_pickup, status, total_price, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${ORDER_COLUMNS}`,
      [userId, addressId, isPickup, status, totalPrice, payload.note || null]
    );

    const order = orderResult.rows[0];
    const insertedItems =
      items.length > 0 ? await insertItems(client, order.id, items) : [];

    await client.query("COMMIT");
    return { ...order, items: insertedItems };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.status) throw err;
    if (err.code === "23503") {
      throw httpError("user_id، address_id یا design_id نامعتبر است", 400, "FK_ERROR");
    }
    console.error("Create order error:", err);
    throw httpError(err.message || "خطا در ایجاد سفارش", 500, "DB_ERROR");
  } finally {
    client.release();
  }
}

async function updateOrder(id, payload) {
  const current = await findById(id);
  if (!current) {
    throw httpError("سفارش پیدا نشد", 404, "NOT_FOUND");
  }

  const nextIsPickup =
    payload.is_pickup !== undefined ? Boolean(payload.is_pickup) : current.is_pickup;
  const nextAddressId =
    payload.address_id !== undefined ? payload.address_id : current.address_id;
  validateAddressRule(nextIsPickup, nextAddressId);

  if (payload.status && !ORDER_STATUSES.includes(payload.status)) {
    throw httpError("status نامعتبر است", 400, "INVALID_STATUS");
  }

  const fields = [];
  const values = [];
  let i = 1;

  if (payload.address_id !== undefined) {
    fields.push(`address_id = $${i++}`);
    values.push(payload.address_id || null);
  }
  if (payload.is_pickup !== undefined) {
    fields.push(`is_pickup = $${i++}`);
    values.push(Boolean(payload.is_pickup));
  }
  if (payload.status !== undefined) {
    fields.push(`status = $${i++}`);
    values.push(payload.status);
  }
  if (payload.total_price !== undefined) {
    const total = Number(payload.total_price);
    if (!Number.isInteger(total) || total < 0) {
      throw httpError("total_price معتبر نیست", 400, "VALIDATION_ERROR");
    }
    fields.push(`total_price = $${i++}`);
    values.push(total);
  }
  if (payload.note !== undefined) {
    fields.push(`note = $${i++}`);
    values.push(payload.note || null);
  }

  if (fields.length === 0) {
    throw httpError("هیچ فیلدی برای بروزرسانی ارسال نشده", 400, "NO_FIELDS");
  }

  values.push(id);
  try {
    const result = await query(
      `UPDATE orders SET ${fields.join(", ")}
       WHERE id = $${i}
       RETURNING ${ORDER_COLUMNS}`,
      values
    );
    const items = await getItemsByOrderId(id);
    return { ...result.rows[0], items };
  } catch (err) {
    if (err.code === "23503") {
      throw httpError("address_id نامعتبر است", 400, "FK_ERROR");
    }
    throw err;
  }
}

async function deleteOrder(id) {
  const result = await query(
    `DELETE FROM orders WHERE id = $1 RETURNING ${ORDER_COLUMNS}`,
    [id]
  );
  if (!result.rows[0]) {
    throw httpError("سفارش پیدا نشد", 404, "NOT_FOUND");
  }
  return result.rows[0];
}

function assertOrderAccess(order, currentUser) {
  if (!order) {
    throw httpError("سفارش پیدا نشد", 404, "NOT_FOUND");
  }
  if (currentUser.role !== "admin" && order.user_id !== currentUser.id) {
    throw httpError("دسترسی غیرمجاز", 403, "FORBIDDEN");
  }
}

module.exports = {
  ORDER_STATUSES,
  listOrders,
  getOrderWithItems,
  findById,
  createOrder,
  updateOrder,
  deleteOrder,
  getItemsByOrderId,
  assertOrderAccess,
  calcTotalFromItems,
};
