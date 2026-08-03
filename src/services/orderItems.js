const { query } = require("../db");
const ordersService = require("./orders");

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function findById(id) {
  const result = await query(
    `SELECT id, order_id, design_id, quantity, unit_price, custom_data, item_note
     FROM order_items
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function listItems({ orderId = null } = {}) {
  if (orderId) {
    return ordersService.getItemsByOrderId(orderId);
  }
  const result = await query(
    `SELECT id, order_id, design_id, quantity, unit_price, custom_data, item_note
     FROM order_items
     ORDER BY id DESC`
  );
  return result.rows;
}

async function createItem(payload, currentUser) {
  if (!payload.order_id || !payload.design_id) {
    throw httpError("order_id و design_id الزامی هستند", 400, "VALIDATION_ERROR");
  }
  if (payload.unit_price === undefined || payload.unit_price === null) {
    throw httpError("unit_price الزامی است", 400, "VALIDATION_ERROR");
  }

  const order = await ordersService.findById(payload.order_id);
  ordersService.assertOrderAccess(order, currentUser);

  const quantity = Number(payload.quantity ?? 1);
  const unitPrice = Number(payload.unit_price);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw httpError("quantity باید عدد صحیح بزرگ‌تر از صفر باشد", 400, "VALIDATION_ERROR");
  }
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    throw httpError("unit_price باید عدد صحیح غیرمنفی باشد", 400, "VALIDATION_ERROR");
  }

  try {
    const result = await query(
      `INSERT INTO order_items
         (order_id, design_id, quantity, unit_price, custom_data, item_note)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, order_id, design_id, quantity, unit_price, custom_data, item_note`,
      [
        payload.order_id,
        payload.design_id,
        quantity,
        unitPrice,
        JSON.stringify(payload.custom_data || {}),
        payload.item_note || null,
      ]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === "23503") {
      throw httpError("order_id یا design_id نامعتبر است", 400, "FK_ERROR");
    }
    throw err;
  }
}

async function updateItem(id, payload, currentUser) {
  const item = await findById(id);
  if (!item) {
    throw httpError("آیتم پیدا نشد", 404, "NOT_FOUND");
  }

  const order = await ordersService.findById(item.order_id);
  ordersService.assertOrderAccess(order, currentUser);

  const fields = [];
  const values = [];
  let i = 1;

  if (payload.design_id !== undefined) {
    fields.push(`design_id = $${i++}`);
    values.push(payload.design_id);
  }
  if (payload.quantity !== undefined) {
    const quantity = Number(payload.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw httpError("quantity معتبر نیست", 400, "VALIDATION_ERROR");
    }
    fields.push(`quantity = $${i++}`);
    values.push(quantity);
  }
  if (payload.unit_price !== undefined) {
    const unitPrice = Number(payload.unit_price);
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      throw httpError("unit_price معتبر نیست", 400, "VALIDATION_ERROR");
    }
    fields.push(`unit_price = $${i++}`);
    values.push(unitPrice);
  }
  if (payload.custom_data !== undefined) {
    fields.push(`custom_data = $${i++}::jsonb`);
    values.push(JSON.stringify(payload.custom_data || {}));
  }
  if (payload.item_note !== undefined) {
    fields.push(`item_note = $${i++}`);
    values.push(payload.item_note || null);
  }

  if (fields.length === 0) {
    throw httpError("هیچ فیلدی برای بروزرسانی ارسال نشده", 400, "NO_FIELDS");
  }

  values.push(id);
  try {
    const result = await query(
      `UPDATE order_items SET ${fields.join(", ")}
       WHERE id = $${i}
       RETURNING id, order_id, design_id, quantity, unit_price, custom_data, item_note`,
      values
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === "23503") {
      throw httpError("design_id نامعتبر است", 400, "FK_ERROR");
    }
    throw err;
  }
}

async function deleteItem(id, currentUser) {
  const item = await findById(id);
  if (!item) {
    throw httpError("آیتم پیدا نشد", 404, "NOT_FOUND");
  }

  const order = await ordersService.findById(item.order_id);
  ordersService.assertOrderAccess(order, currentUser);

  const result = await query(
    `DELETE FROM order_items
     WHERE id = $1
     RETURNING id, order_id, design_id, quantity, unit_price, custom_data, item_note`,
    [id]
  );
  return result.rows[0];
}

module.exports = {
  findById,
  listItems,
  createItem,
  updateItem,
  deleteItem,
};
