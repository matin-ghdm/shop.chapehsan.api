const { pool, query } = require("../db");
const { hasPermission } = require("../lib/panel-permissions");

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
  "id, user_id, address_id, is_pickup, status, total_price, subtotal_price, discount_code, discount_amount, shipping_fee, rush_order, rush_fee, delivery_date, delivery_time, next_business_day_confirmed, wallet_amount, amount_before_wallet, note, created_at, payment_track_id, payment_ref_number, payment_card_number, paid_at, invoice_type, invoice_name, invoice_national_id, invoice_economic_code, invoice_registration_number, invoice_phone, invoice_address, invoice_postal_code, invoice_issued_at";

const INVOICE_FIELDS = [
  "invoice_type",
  "invoice_name",
  "invoice_national_id",
  "invoice_economic_code",
  "invoice_registration_number",
  "invoice_phone",
  "invoice_address",
  "invoice_postal_code",
];

function normalizeInvoicePayload(payload = {}) {
  const type = String(payload.invoice_type || "").trim();
  const name = String(payload.invoice_name || "").trim();
  if (type !== "personal" && type !== "company") {
    throw httpError("نوع فاکتور را انتخاب کنید", 400, "INVALID_INVOICE_TYPE");
  }
  if (!name) {
    throw httpError(type === "company" ? "نام رسمی شرکت را وارد کنید" : "نام خریدار را وارد کنید", 400, "INVOICE_NAME_REQUIRED");
  }
  const nationalId = String(payload.invoice_national_id || "").trim();
  if (type === "company" && !nationalId) {
    throw httpError("شناسه ملی شرکت را وارد کنید", 400, "INVOICE_NATIONAL_ID_REQUIRED");
  }
  const values = {
    invoice_type: type,
    invoice_name: name,
    invoice_national_id: nationalId,
    invoice_economic_code: String(payload.invoice_economic_code || "").trim(),
    invoice_registration_number: String(payload.invoice_registration_number || "").trim(),
    invoice_phone: String(payload.invoice_phone || "").trim(),
    invoice_address: String(payload.invoice_address || "").trim(),
    invoice_postal_code: String(payload.invoice_postal_code || "").trim(),
  };
  const limits = {
    invoice_name: 200,
    invoice_national_id: 32,
    invoice_economic_code: 32,
    invoice_registration_number: 32,
    invoice_phone: 32,
    invoice_address: 1000,
    invoice_postal_code: 20,
  };
  for (const [field, max] of Object.entries(limits)) {
    if (values[field].length > max) {
      throw httpError("یکی از مشخصات فاکتور بیش از حد طولانی است", 400, "INVOICE_FIELD_TOO_LONG");
    }
  }
  return values;
}

function tehranClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: values.year + "-" + values.month + "-" + values.day,
    time: values.hour + ":" + values.minute,
    weekday: values.weekday,
  };
}

function nextBusinessDate(date, openWeekdays) {
  const [year, month, day] = date.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (!openWeekdays.includes(cursor.getUTCDay()));
  return cursor.getUTCFullYear() + "-" +
    String(cursor.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(cursor.getUTCDate()).padStart(2, "0");
}

async function validateOrderSchedule(payload, currentUser) {
  const { getOrderScheduleSettings } = require("./order-schedule");
  const settings = await getOrderScheduleSettings();
  const deliveryDate = String(payload.delivery_date || "").slice(0, 10);
  const deliveryTime = String(payload.delivery_time || "").slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !/^\d{2}:\d{2}$/.test(deliveryTime)) {
    throw httpError("تاریخ و ساعت ارسال را انتخاب کنید", 400, "DELIVERY_SCHEDULE_REQUIRED");
  }
  const [year, month, day] = deliveryDate.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw httpError("تاریخ ارسال معتبر نیست", 400, "INVALID_DELIVERY_DATE");
  }
  if (!settings.openWeekdays.includes(parsedDate.getUTCDay())) {
    throw httpError("این روز کاری نیست؛ تاریخ دیگری انتخاب کنید", 400, "NON_BUSINESS_DELIVERY_DATE");
  }
  const [hour, minute] = deliveryTime.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59 ||
      deliveryTime < settings.deliveryStartTime || deliveryTime > settings.deliveryEndTime) {
    throw httpError(`ساعت ارسال باید بین ${settings.deliveryStartTime} تا ${settings.deliveryEndTime} باشد`, 400, "INVALID_DELIVERY_TIME");
  }
  const now = tehranClock();
  const weekdayNumbers = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const isOpen = settings.openWeekdays.includes(weekdayNumbers[now.weekday]) &&
    now.time >= settings.orderOpenTime && now.time < settings.orderCutoffTime;
  const earliestDate = isOpen ? now.date : nextBusinessDate(now.date, settings.openWeekdays);
  if (deliveryDate < earliestDate) {
    throw httpError("تاریخ ارسال نمی‌تواند پیش از نزدیک‌ترین روز کاری باشد", 400, "DELIVERY_DATE_TOO_EARLY");
  }
  if (deliveryDate === now.date && isOpen && deliveryTime <= now.time) {
    throw httpError("ساعت ارسال باید از ساعت فعلی دیرتر باشد", 400, "DELIVERY_TIME_IN_PAST");
  }
  const confirmedNextBusinessDay = payload.next_business_day_confirmed === true;
  if (!isOpen && currentUser.role !== "admin") {
    if (!confirmedNextBusinessDay) {
      throw httpError(
        `ساعت ثبت سفارش سریع ${settings.orderOpenTime} تا ${settings.orderCutoffTime} است. برای ثبت سفارش خارج از این ساعت، انجام آن در روز کاری بعد را تأیید کنید.`,
        400,
        "NEXT_BUSINESS_DAY_CONFIRMATION_REQUIRED"
      );
    }
  }
  return { deliveryDate, deliveryTime, confirmedNextBusinessDay };
}

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
    `SELECT ${ORDER_COLUMNS_ALIASED}, ${ORDER_USER_FIELDS}, ${ORDER_ADDRESS_FIELDS}, ${ORDER_QUEUE_POSITION_SQL}
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
  u.phone AS user_phone,
  EXISTS (SELECT 1 FROM download_purchases dp WHERE dp.order_id = o.id) AS is_digital`;

const ORDER_ADDRESS_FIELDS = `
  a.title AS address_title,
  a.province AS address_province,
  a.city AS address_city,
  a.address AS delivery_address,
  a.postal_code AS address_postal_code,
  a.phone AS address_phone`;

const ORDER_QUEUE_POSITION_SQL = `CASE
  WHEN o.status IN ('paid', 'confirmed') AND EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = o.id
      AND COALESCE(oi.custom_data->>'design_type', oi.custom_data->>'type') IN
        ('taslit', 'taslit-banner', 'stand', 'stand-banner', 'hajj', 'hajj-banner', 'karbala', 'karbala-banner', 'occasion', 'occasion-banner')
  ) THEN (
    SELECT COUNT(*)::int FROM orders q
    WHERE q.status IN ('paid', 'confirmed')
      AND EXISTS (
        SELECT 1 FROM order_items qi
        WHERE qi.order_id = q.id
          AND COALESCE(qi.custom_data->>'design_type', qi.custom_data->>'type') IN
            ('taslit', 'taslit-banner', 'stand', 'stand-banner', 'hajj', 'hajj-banner', 'karbala', 'karbala-banner', 'occasion', 'occasion-banner')
      )
      AND (q.rush_order > o.rush_order OR (q.rush_order = o.rush_order AND (q.created_at < o.created_at OR (q.created_at = o.created_at AND q.id <= o.id))))
  ) ELSE NULL END AS queue_position`;

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
      `SELECT ${ORDER_COLUMNS_ALIASED}, ${ORDER_USER_FIELDS}, ${ORDER_ADDRESS_FIELDS}, ${ORDER_QUEUE_POSITION_SQL}
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
    `SELECT ${ORDER_COLUMNS_ALIASED}, ${ORDER_USER_FIELDS}, ${ORDER_ADDRESS_FIELDS}, ${ORDER_QUEUE_POSITION_SQL}
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
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 999) {
      throw httpError("quantity باید عدد صحیح بین ۱ و ۹۹۹ باشد", 400, "VALIDATION_ERROR");
    }

    if (item.unit_price === undefined || item.unit_price === null) {
      throw httpError("unit_price برای آیتم الزامی است", 400, "VALIDATION_ERROR");
    }
    let unitPrice = Number(item.unit_price);
    let customData = item.custom_data || {};
    const designResult = await client.query("SELECT type, price, is_active, product_options FROM designs WHERE id = $1", [designId]);
    const design = designResult.rows[0];
    if (["davati", "hamdardi"].includes(design?.type) && quantity < 20) {
      throw httpError("حداقل تعداد سفارش این کارت ۲۰ عدد است", 400, "MINIMUM_QUANTITY_REQUIRED");
    }
    if (design?.type) customData = { ...customData, design_type: design.type };
    if (design?.type === "occasion") {
      if (!design.is_active) throw httpError("این محصول غیرفعال است", 400, "VALIDATION_ERROR");
      const quote = require("./product-options").quoteProduct(design, customData.productSelection, quantity);
      if (unitPrice !== quote.price && unitPrice !== quote.legacyPrice) throw httpError("قیمت محصول تغییر کرده است؛ محصول را دوباره به سبد اضافه کنید", 409, "PRICE_CHANGED");
      unitPrice = quote.price;
      customData = { ...customData, design_type: "occasion", type: "occasion-banner", productSelection: quote.selection };
    }
    if (design?.type === "decorative" || design?.type === "laser") {
      if (!design.is_active) throw httpError("این محصول غیرفعال است", 400, "VALIDATION_ERROR");
      const quote = require("./product-options").quoteProduct(design, customData.productSelection, quantity);
      if (unitPrice !== quote.price && unitPrice !== quote.legacyPrice) {
        throw httpError("قیمت محصول تغییر کرده است؛ محصول را دوباره به سبد اضافه کنید", 409, "PRICE_CHANGED");
      }
      unitPrice = quote.price;
      customData = {
        ...customData,
        design_type: design.type,
        type: design.type === "decorative" ? "decorative-product" : "laser-product",
        productSelection: quote.selection,
      };
    }
    const configurableOrderTypes = ["taslit", "stand", "hamdardi", "hajj", "karbala", "davati"];
    const configuredOptions = design?.product_options;
    if (configurableOrderTypes.includes(design?.type) &&
        ((configuredOptions?.fields?.length || 0) > 0 || (configuredOptions?.extras?.length || 0) > 0 || customData.productSelection)) {
      if (!design.is_active) throw httpError("این محصول غیرفعال است", 400, "VALIDATION_ERROR");
      const quote = require("./product-options").quoteProduct(design, customData.productSelection, quantity);
      if (unitPrice !== quote.price && unitPrice !== quote.legacyPrice) {
        throw httpError("قیمت محصول تغییر کرده است؛ محصول را دوباره به سبد اضافه کنید", 409, "PRICE_CHANGED");
      }
      unitPrice = quote.price;
      customData = { ...customData, productSelection: quote.selection };
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
  return items.reduce((sum, item) => {
    const extras = item.custom_data?.productSelection?.extras;
    if (Array.isArray(extras) && extras.length > 0 && extras.every(extra => Number.isInteger(Number(extra.quantity)) && Number(extra.quantity) > 0)) {
      return sum + Number(item.quantity) * Number(item.unit_price) + extras.reduce((extraSum, extra) => extraSum + Number(extra.price) * Number(extra.quantity), 0);
    }
    return sum + Number(item.quantity) * Number(item.unit_price);
  }, 0);
}

async function createOrder(payload, currentUser) {
  const userId =
    currentUser.role === "admin" && payload.user_id
      ? payload.user_id
      : currentUser.id;

  const isPickup = Boolean(payload.is_pickup);
  const addressId = payload.address_id || null;
  validateAddressRule(isPickup, addressId);
  const schedule = await validateOrderSchedule(payload, currentUser);

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

  const status = hasPermission(currentUser, "orders.manage") && payload.status
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
         (user_id, address_id, is_pickup, status, total_price, note,
          delivery_date, delivery_time, next_business_day_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${ORDER_COLUMNS}`,
      [
        userId,
        addressId,
        isPickup,
        status,
        totalPrice,
        payload.note || null,
        schedule.deliveryDate,
        schedule.deliveryTime,
        schedule.confirmedNextBusinessDay,
      ]
    );

    const order = orderResult.rows[0];
    const insertedItems =
      items.length > 0 ? await insertItems(client, order.id, items) : [];
    let finalOrder = order;
    let amountBeforeWallet = totalPrice;
    if (insertedItems.length > 0) {
      const subtotal = calcTotalFromItems(insertedItems);
      if (!Number.isSafeInteger(subtotal) || subtotal < 1) throw httpError("جمع محصولات سفارش معتبر نیست", 400, "VALIDATION_ERROR");
      const bannerTypes = new Set(["taslit", "taslit-banner", "stand", "stand-banner", "hajj", "hajj-banner", "karbala", "karbala-banner", "occasion", "occasion-banner"]);
      const containsBanner = insertedItems.some((item) => bannerTypes.has(String(item.custom_data?.design_type || item.custom_data?.type || "").toLowerCase()));
      const rushOrder = payload.rush_order === true;
      if (rushOrder && !containsBanner) throw httpError("سفارش فوری فقط برای سفارش‌های دارای بنر قابل انتخاب است", 400, "RUSH_REQUIRES_BANNER");
      const { getOrderScheduleSettings } = require("./order-schedule");
      const scheduleSettings = await getOrderScheduleSettings();
      const rushFee = rushOrder ? scheduleSettings.urgentOrderFee : 0;
      let discountCode = null;
      let discountAmount = 0;
      if (couponCode) {
        const discount = await require("./discount-codes").calculateDiscount(couponCode, subtotal, client, insertedItems);
        discountCode = discount.code;
        discountAmount = discount.discount_amount;
      }
      const finalTotal = subtotal - discountAmount + shippingFee + rushFee;
      if (!Number.isSafeInteger(finalTotal) || finalTotal < 0) throw httpError("مبلغ نهایی سفارش معتبر نیست", 400, "VALIDATION_ERROR");
      const updated = await client.query(
        `UPDATE orders SET total_price=$1, subtotal_price=$2, discount_code=$3, discount_amount=$4, shipping_fee=$5, rush_order=$6, rush_fee=$7 WHERE id=$8 RETURNING ${ORDER_COLUMNS}`,
        [finalTotal, subtotal, discountCode, discountAmount, shippingFee, rushOrder, rushFee, order.id]
      );
      finalOrder = updated.rows[0];
      amountBeforeWallet = finalTotal;
    } else if (payload.rush_order === true) {
      throw httpError("سفارش فوری فقط برای سفارش‌های دارای بنر قابل انتخاب است", 400, "RUSH_REQUIRES_BANNER");
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

async function issueInvoice(id, payload, currentUser) {
  const invoice = normalizeInvoicePayload(payload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const order = locked.rows[0];
    assertOrderAccess(order, currentUser);
    if (order.invoice_issued_at) {
      throw httpError("فاکتور این سفارش قبلاً صادر شده و فقط مدیر می‌تواند آن را ویرایش کند", 409, "INVOICE_ALREADY_ISSUED");
    }
    const result = await client.query(
      `UPDATE orders SET
        invoice_type = $1,
        invoice_name = $2,
        invoice_national_id = $3,
        invoice_economic_code = $4,
        invoice_registration_number = $5,
        invoice_phone = $6,
        invoice_address = $7,
        invoice_postal_code = $8,
        invoice_issued_at = NOW()
       WHERE id = $9
       RETURNING ${ORDER_COLUMNS}`,
      [
        invoice.invoice_type,
        invoice.invoice_name,
        invoice.invoice_national_id,
        invoice.invoice_economic_code,
        invoice.invoice_registration_number,
        invoice.invoice_phone,
        invoice.invoice_address,
        invoice.invoice_postal_code,
        id,
      ],
    );
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

async function updateOrderInvoice(id, payload) {
  const invoice = normalizeInvoicePayload(payload);
  const current = await findById(id);
  if (!current) throw httpError("سفارش پیدا نشد", 404, "NOT_FOUND");
  if (!current.invoice_issued_at) {
    throw httpError("فاکتور این سفارش هنوز توسط مشتری صادر نشده است", 409, "INVOICE_NOT_ISSUED");
  }
  const result = await query(
    `UPDATE orders SET
      invoice_type = $1,
      invoice_name = $2,
      invoice_national_id = $3,
      invoice_economic_code = $4,
      invoice_registration_number = $5,
      invoice_phone = $6,
      invoice_address = $7,
      invoice_postal_code = $8
     WHERE id = $9
     RETURNING ${ORDER_COLUMNS}`,
    [
      invoice.invoice_type,
      invoice.invoice_name,
      invoice.invoice_national_id,
      invoice.invoice_economic_code,
      invoice.invoice_registration_number,
      invoice.invoice_phone,
      invoice.invoice_address,
      invoice.invoice_postal_code,
      id,
    ],
  );
  return { ...result.rows[0], items: await getItemsByOrderId(id) };
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
  if (!hasPermission(currentUser, "orders.view") && order.user_id !== currentUser.id) {
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
  issueInvoice,
  updateOrderInvoice,
  normalizeInvoicePayload,
  deleteOrder,
  getItemsByOrderId,
  assertOrderAccess,
  calcTotalFromItems,
};
