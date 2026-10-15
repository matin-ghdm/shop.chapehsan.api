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
  "id, user_id, address_id, is_pickup, status, total_price, subtotal_price, discount_code, discount_amount, shipping_fee, wallet_amount, amount_before_wallet, note, created_at, payment_track_id, payment_ref_number, payment_card_number, paid_at";

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

async function attachItemsToOrders(orders) {
  if (!orders.length) return orders;

  const result = await query(
    `SELECT id, order_id, design_id, quantity, unit_price, custom_data, item_note
     FROM order_items
     WHERE order_id = ANY($1::uuid[])
     ORDER BY order_id, id`,
    [orders.map((order) => order.id)]
  );

  const itemsByOrderId = new Map();
  for (const item of result.rows) {
    const list = itemsByOrderId.get(item.order_id) || [];
    list.push(item);
    itemsByOrderId.set(item.order_id, list);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByOrderId.get(order.id) || [],
  }));
}

async function findById(id) {
  const result = await query(
    `SELECT ${ORDER_COLUMNS_ALIASED}, ${ORDER_USER_FIELDS}, ${ORDER_ADDRESS_FIELDS}
     ${ORDER_FROM_WITH_USER}
     WHERE o.id = $1`,
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

const ORDER_COLUMNS_ALIASED = ORDER_COLUMNS.split(", ")
  .map((column) => `o.${column.trim()}`)
  .join(", ");

const ORDER_USER_FIELDS = `
  TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lname, ''))) AS user_name,
  u.phone AS user_phone`;

const ORDER_ADDRESS_FIELDS = `
  a.title AS address_title,
  a.province AS address_province,
  a.city AS address_city,
  a.address AS delivery_address,
  a.postal_code AS address_postal_code,
  a.phone AS address_phone`;

const ORDER_FROM_WITH_USER =
  "FROM orders o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN addresses a ON a.id = o.address_id";

function parsePickupFilter(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return null;
}

function normalizeAsciiDigits(value) {
  return String(value)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - "۰".charCodeAt(0)))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - "٠".charCodeAt(0)));
}

async function listOrders({
  userId = null,
  status = null,
  q = null,
  from = null,
  to = null,
  isPickup = null,
  page = null,
  limit = null,
  since = null,
  includeItems = false,
} = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (userId) {
    conditions.push(`o.user_id = $${i++}`);
    values.push(userId);
  }
  if (status) {
    conditions.push(`o.status = $${i++}`);
    values.push(status);
  }

  const pickupFilter = parsePickupFilter(isPickup);
  if (pickupFilter !== null) {
    conditions.push(`o.is_pickup = $${i++}`);
    values.push(pickupFilter);
  }

  if (from) {
    conditions.push(`o.created_at >= $${i++}::date`);
    values.push(normalizeAsciiDigits(from));
  }
  if (to) {
    conditions.push(`o.created_at < ($${i++}::date + interval '1 day')`);
    values.push(normalizeAsciiDigits(to));
  }
  if (since) {
    conditions.push(`o.created_at > $${i++}::timestamptz`);
    values.push(normalizeAsciiDigits(since));
  }

  const searchTerm = String(q || "").trim();
  if (searchTerm) {
    conditions.push(`(
      o.id::text ILIKE $${i}
      OR COALESCE(o.note, '') ILIKE $${i}
      OR EXISTS (
        SELECT 1
        FROM order_items oi
        WHERE oi.order_id = o.id
          AND (
            oi.custom_data::text ILIKE $${i}
            OR COALESCE(oi.item_note, '') ILIKE $${i}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM users u
        WHERE u.id = o.user_id
          AND (
            COALESCE(u.phone, '') ILIKE $${i}
            OR COALESCE(u.name, '') ILIKE $${i}
            OR COALESCE(u.lname, '') ILIKE $${i}
            OR CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.lname, '')) ILIKE $${i}
          )
      )
    )`);
    values.push(`%${searchTerm}%`);
    i++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const paginate = page !== null || limit !== null;
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);

  if (paginate) {
    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM orders o ${where}`,
      values
    );
    const total = countResult.rows[0]?.total || 0;
    const offset = (safePage - 1) * safeLimit;

    const result = await query(
      `SELECT ${ORDER_COLUMNS_ALIASED}, ${ORDER_USER_FIELDS}, ${ORDER_ADDRESS_FIELDS}
       ${ORDER_FROM_WITH_USER}
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, safeLimit, offset]
    );

    return {
      orders: includeItems
        ? await attachItemsToOrders(result.rows)
        : result.rows,
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.max(Math.ceil(total / safeLimit), 1),
    };
  }

  const result = await query(
    `SELECT ${ORDER_COLUMNS_ALIASED}, ${ORDER_USER_FIELDS}, ${ORDER_ADDRESS_FIELDS}
     ${ORDER_FROM_WITH_USER}
     ${where}
     ORDER BY o.created_at DESC`,
    values
  );
  return {
    orders: includeItems
      ? await attachItemsToOrders(result.rows)
      : result.rows,
  };
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
  if (type === "occasion") throw httpError("محصول مناسبتی پیدا نشد", 404, "NOT_FOUND");

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
    let unitPrice = Number(item.unit_price);
    let customData = item.custom_data || {};
    const designResult = await client.query("SELECT type, price, is_active, product_options FROM designs WHERE id = $1", [designId]);
    const design = designResult.rows[0];
    if (design?.type) customData = { ...customData, design_type: design.type };
    if (design?.type === "occasion") {
      if (!design.is_active) throw httpError("این محصول غیرفعال است", 400, "VALIDATION_ERROR");
      const quote = require("./product-options").quoteProduct(design, customData.productSelection);
      if (unitPrice !== quote.price) throw httpError("قیمت محصول تغییر کرده است؛ محصول را دوباره به سبد اضافه کنید", 409, "PRICE_CHANGED");
      unitPrice = quote.price;
      customData = { ...customData, design_type: "occasion", type: "occasion-banner", productSelection: quote.selection };
    }
    if (design?.type === "laser" || design?.type === "decorative") {
      if (!design.is_active) throw httpError("این محصول غیرفعال است", 400, "VALIDATION_ERROR");
      if (!Number.isInteger(Number(design.price)) || Number(design.price) <= 0) {
        throw httpError("این محصول قیمت فروش ندارد", 400, "VALIDATION_ERROR");
      }
      if (unitPrice !== Number(design.price)) {
        throw httpError("قیمت محصول تغییر کرده است؛ محصول را دوباره به سبد اضافه کنید", 409, "PRICE_CHANGED");
      }
      unitPrice = Number(design.price);
      customData = {
        ...customData,
        design_type: design.type,
        type: design.type === "decorative" ? "decorative-product" : "laser-product",
      };
    }
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
        JSON.stringify(customData),
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

  if (totalPrice === null || !Number.isSafeInteger(totalPrice) || totalPrice < 0) {
    throw httpError("total_price معتبر نیست", 400, "VALIDATION_ERROR");
  }

  const status = currentUser.role === "admin" && payload.status
    ? payload.status
    : "awaiting_payment";
  if (!ORDER_STATUSES.includes(status)) {
    throw httpError("status نامعتبر است", 400, "INVALID_STATUS");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const couponCode = String(payload.discount_code || "").trim();
    const shippingFee = Number(payload.shipping_fee ?? 0);
    if (!Number.isSafeInteger(shippingFee) || shippingFee < 0 || shippingFee > 1000000000) {
      throw httpError("هزینه ارسال معتبر نیست", 400, "VALIDATION_ERROR");
    }

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
    let finalOrder = order;
    let amountBeforeWallet = totalPrice;
    if (couponCode) {
      const subtotal = calcTotalFromItems(insertedItems);
      if (!Number.isSafeInteger(subtotal) || subtotal < 1) throw httpError("جمع محصولات برای تخفیف معتبر نیست", 400, "VALIDATION_ERROR");
      const discount = await require("./discount-codes").calculateDiscount(couponCode, subtotal, client, insertedItems);
      const finalTotal = subtotal - discount.discount_amount + shippingFee;
      const updated = await client.query(
        `UPDATE orders SET total_price=$1, subtotal_price=$2, discount_code=$3, discount_amount=$4, shipping_fee=$5 WHERE id=$6 RETURNING ${ORDER_COLUMNS}`,
        [finalTotal, subtotal, discount.code, discount.discount_amount, shippingFee, order.id]
      );
      finalOrder = updated.rows[0];
      amountBeforeWallet = finalTotal;
    }
    if (!couponCode && insertedItems.length > 0 && totalPrice < calcTotalFromItems(insertedItems)) {
      throw httpError("مبلغ سفارش کمتر از جمع قیمت محصولات است", 400, "VALIDATION_ERROR");
    }

    const walletService = require("./wallet");
    const walletBalance = await walletService.getBalance(userId, client);
    const walletAmount = Math.min(walletBalance, amountBeforeWallet);
    const amountDue = amountBeforeWallet - walletAmount;
    const paymentStatus = amountDue === 0 ? "paid" : finalOrder.status;
    const walletUpdated = await client.query(
      `UPDATE orders
       SET total_price = $1, wallet_amount = $2, amount_before_wallet = $3,
           status = $4, paid_at = CASE WHEN $1 = 0 THEN NOW() ELSE paid_at END
       WHERE id = $5 RETURNING ${ORDER_COLUMNS}`,
      [amountDue, walletAmount, amountBeforeWallet, paymentStatus, order.id],
    );
    finalOrder = walletUpdated.rows[0];
    if (walletAmount > 0) {
      await walletService.addTransaction(client, {
        userId,
        orderId: order.id,
        type: "order_wallet_payment",
        amount: -walletAmount,
      });
    }

    await client.query("COMMIT");
    return { ...finalOrder, items: insertedItems };
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
  const digital = await query('SELECT 1 FROM download_purchases WHERE order_id=$1',[id]);
  if (digital.rowCount) throw httpError('سفارش فایل دیجیتال قابل تغییر نیست',403);
  const current = await findById(id);
  if (!current) {
    throw httpError("سفارش پیدا نشد", 404, "NOT_FOUND");
  }
  if (current.status === "canceled" && payload.status && payload.status !== "canceled") {
    throw httpError("سفارش لغوشده قابل فعال‌سازی دوباره نیست؛ یک سفارش تازه ثبت کنید", 409, "ORDER_CANCELED");
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
  if (payload.status === "canceled") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const lockedOrder = locked.rows[0];
      if (!lockedOrder) throw httpError("سفارش پیدا نشد", 404, "NOT_FOUND");
      const result = await client.query(
        `UPDATE orders SET ${fields.join(", ")} WHERE id = $${i}
         RETURNING ${ORDER_COLUMNS}`,
        values,
      );
      if (lockedOrder.status !== "canceled") {
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [lockedOrder.user_id]);
        const refund = Number(lockedOrder.wallet_amount || 0) +
          (lockedOrder.paid_at ? Number(lockedOrder.total_price || 0) : 0);
        if (refund > 0) {
          const walletService = require("./wallet");
          await walletService.addTransaction(client, {
            userId: lockedOrder.user_id,
            orderId: lockedOrder.id,
            type: "order_cancel_refund",
            amount: refund,
          });
        }
      }
      const items = await getItemsByOrderId(id, client);
      await client.query("COMMIT");
      return { ...result.rows[0], items };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

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
  const order = await findById(id);
  if (!order) throw httpError("سفارش پیدا نشد", 404, "NOT_FOUND");
  if (Number(order.wallet_amount || 0) > 0 || order.paid_at || order.payment_track_id) {
    throw httpError("این سفارش سابقه مالی دارد و برای حفظ سابقه پرداخت قابل حذف نیست", 409, "ORDER_HAS_FINANCIAL_HISTORY");
  }
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
