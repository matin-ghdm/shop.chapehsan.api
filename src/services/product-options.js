function invalid(message) {
  return Object.assign(new Error(message), { status: 400, code: "VALIDATION_ERROR" });
}
function amount(value, positive = false) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < (positive ? 1 : 0) || n > 1000000000) throw invalid("قیمت گزینه‌های محصول معتبر نیست");
  return n;
}
function dimension(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 2000) throw invalid("ابعاد باید بین ۱ تا ۲۰۰۰ سانتی‌متر باشد");
  return n;
}
function text(value, limit = 120) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw invalid("نام و مشخصات گزینه‌های محصول را کامل کنید");
  return value.trim();
}
function optionalText(value, limit = 120) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > limit) throw invalid("راهنمای فیلد محصول معتبر نیست");
  return value.trim();
}
function normalizeProductOptions(input) {
  if (input == null) return { variants: [], fields: [], extras: [] };
  if (!Array.isArray(input.variants) || input.variants.length > 12) throw invalid("حداکثر ۱۲ نوع برای هر محصول مجاز است");
  const ids = new Set();
  const variants = input.variants.map(v => {
    if (!v || typeof v !== "object") throw invalid("مشخصات نوع بنر معتبر نیست");
    const id = text(v.id, 80);
    if (ids.has(id)) throw invalid("شناسه نوع محصول تکراری است");
    ids.add(id);
    if (!["wall", "stand"].includes(v.kind)) throw invalid("نوع بنر معتبر نیست");
    const image_path = text(v.image_path, 2048);
    if (!/^(https?:\/\/|\/)/i.test(image_path)) throw invalid("آدرس تصویر نوع بنر معتبر نیست");
    if (!Array.isArray(v.extras) || v.extras.length > 20) throw invalid("حداکثر ۲۰ خدمت برای هر نوع مجاز است");
    const extraIds = new Set();
    return { id, name: text(v.name), kind: v.kind, image_path,
      width_cm: dimension(v.width_cm), height_cm: dimension(v.height_cm), price: amount(v.price, true),
      custom_size: { enabled: v.custom_size?.enabled === true, price_per_m2: v.custom_size?.enabled === true ? amount(v.custom_size.price_per_m2, true) : 0 },
      extras: v.extras.map(e => {
        if (!e || typeof e !== "object") throw invalid("مشخصات خدمات معتبر نیست");
        const extraId = text(e.id, 80);
        if (extraIds.has(extraId)) throw invalid("شناسه خدمات تکراری است");
        extraIds.add(extraId);
        return { id: extraId, name: text(e.name), price: amount(e.price) };
      }),
    };
  });
  if (input.fields !== undefined && (!Array.isArray(input.fields) || input.fields.length > 20)) throw invalid("حداکثر ۲۰ مشخصه برای هر محصول مجاز است");
  const fieldIds = new Set();
  const fields = (input.fields || []).map(field => {
    if (!field || typeof field !== "object") throw invalid("مشخصات ورودی محصول معتبر نیست");
    const id = text(field.id, 80);
    if (fieldIds.has(id)) throw invalid("شناسه مشخصه تکراری است");
    fieldIds.add(id);
    const kind = field.kind;
    if (!["text", "textarea", "number", "select", "color", "date", "datetime"].includes(kind)) throw invalid("نوع ورودی محصول معتبر نیست");
    let options = [];
    if (["select", "color"].includes(kind)) {
      if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 30) throw invalid("گزینه‌های فهرست و رنگ را وارد کنید");
      options = [...new Set(field.options.map(option => text(option, 80)))];
    }
    return { id, label: text(field.label, 80), kind, required: field.required === true,
      placeholder: optionalText(field.placeholder, 120), options };
  });
  if (input.extras !== undefined && (!Array.isArray(input.extras) || input.extras.length > 20)) throw invalid("حداکثر ۲۰ خدمت یا جنس اضافه مجاز است");
  const extraIds = new Set();
  const extras = (input.extras || []).map(extra => {
    if (!extra || typeof extra !== "object") throw invalid("مشخصات خدمت یا جنس اضافه معتبر نیست");
    const id = text(extra.id, 80);
    if (extraIds.has(id)) throw invalid("شناسه خدمت یا جنس تکراری است");
    extraIds.add(id);
    return { id, name: text(extra.name), price: amount(extra.price) };
  });
  const rawSettings = input.order_settings;
  if (rawSettings !== undefined && (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings))) throw invalid("تنظیمات فرم سفارش معتبر نیست");
  const pricingMode = rawSettings?.pricing_mode;
  if (pricingMode !== undefined && !["fixed", "variant", "area", "quantity", "extras", "quote"].includes(pricingMode)) throw invalid("روش قیمت‌گذاری محصول معتبر نیست");
  const minimumQuantity = rawSettings?.minimum_quantity === undefined ? undefined : Number(rawSettings.minimum_quantity);
  if (minimumQuantity !== undefined && (!Number.isSafeInteger(minimumQuantity) || minimumQuantity < 1 || minimumQuantity > 100000)) throw invalid("حداقل تعداد سفارش معتبر نیست");
  const order_settings = {
    ...(pricingMode ? { pricing_mode: pricingMode } : {}),
    ...(minimumQuantity !== undefined ? { minimum_quantity: minimumQuantity } : {}),
  };
  if (input.specifications !== undefined && (!Array.isArray(input.specifications) || input.specifications.length > 30)) throw invalid("حداکثر ۳۰ مشخصه برای هر کالا مجاز است");
  const specifications = input.specifications?.map(row => {
    if (!row || typeof row !== "object") throw invalid("مشخصات کالا معتبر نیست");
    return { label: text(row.label, 80), value: text(row.value, 1000) };
  });
  return { variants, fields, extras, ...(Object.keys(order_settings).length ? { order_settings } : {}), ...(specifications !== undefined ? { specifications } : {}) };
}
function quoteProduct(design, selection, productQuantity = 1) {
  function selectedExtras(configured, ids) {
    if (!Array.isArray(ids) || ids.length > configured.length || new Set(ids).size !== ids.length) throw invalid("خدمات انتخاب‌شده معتبر نیست");
    const submitted = new Map((Array.isArray(selection?.extras) ? selection.extras : []).map(extra => [extra?.id, extra?.quantity]));
    return ids.map(id => {
      const extra = configured.find(item => item.id === id);
      if (!extra) throw invalid("خدمت یا جنس انتخاب‌شده برای این محصول موجود نیست");
      const quantity = submitted.get(id) == null ? productQuantity : Number(submitted.get(id));
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) throw invalid("تعداد خدمت یا جنس اضافه معتبر نیست");
      return { ...extra, quantity };
    });
  }
  const options = normalizeProductOptions(design.product_options);
  const minimumQuantity = options.order_settings?.minimum_quantity || 1;
  if (!Number.isSafeInteger(productQuantity) || productQuantity < minimumQuantity) throw invalid(`حداقل تعداد سفارش این محصول ${minimumQuantity} عدد است`);
  const variants = options.variants;
  if (!variants.length) {
    if (selection?.variant_id || selection?.custom_size) throw invalid("این محصول نوع یا اندازهٔ سفارشی ندارد");
    if (selection?.fields !== undefined && !Array.isArray(selection.fields)) throw invalid("مشخصات ارسالی برای این محصول معتبر نیست");
    const submittedFields = selection?.fields || [];
    if (submittedFields.length > options.fields.length) throw invalid("مشخصات ارسالی برای این محصول معتبر نیست");
    if (new Set(submittedFields.map(field => field?.id)).size !== submittedFields.length) throw invalid("مشخصهٔ تکراری ارسال شده است");
    const submittedById = new Map(submittedFields.map(field => [field?.id, field?.value]));
    const fields = options.fields.map(field => {
      const rawValue = submittedById.get(field.id);
      const value = rawValue == null ? "" : String(rawValue).trim();
      if (field.required && !value) throw invalid(`تکمیل «${field.label}» الزامی است`);
      if (value.length > 1000) throw invalid(`مقدار «${field.label}» بیش از حد طولانی است`);
      if (value && field.kind === "number" && !/^[0-9۰-۹٠-٩]+$/.test(value)) throw invalid(`«${field.label}» را فقط با عدد وارد کنید`);
      if (value && ["select", "color"].includes(field.kind) && !field.options.includes(value)) throw invalid(`گزینهٔ «${field.label}» معتبر نیست`);
      return value ? { id: field.id, label: field.label, value } : null;
    }).filter(Boolean);
    if (submittedFields.some(field => !options.fields.some(configured => configured.id === field?.id))) throw invalid("مشخصهٔ ارسالی برای این محصول تعریف نشده است");
    const ids = selection?.extra_ids ?? [];
    const extras = selectedExtras(options.extras, ids);
    const price = amount(design.price);
    const total = price + extras.reduce((sum, extra) => sum + extra.price * extra.quantity, 0);
    const legacyPrice = price + extras.reduce((sum, extra) => sum + extra.price, 0);
    if (!Number.isSafeInteger(total) || total < 1 || total > 1000000000) throw invalid("برای ثبت سفارش، حداقل یک گزینهٔ قیمت‌دار انتخاب کنید");
    const configured = options.fields.length > 0 || options.extras.length > 0;
    return { price, legacyPrice, selection: configured ? { fields, extra_ids: ids, extras } : null };
  }
  const v = variants.find(v => v.id === selection?.variant_id);
  if (!v) throw invalid("نوع محصول انتخاب‌شده در دسترس نیست؛ دوباره انتخاب کنید");
  let width = v.width_cm, height = v.height_cm, price = v.price;
  const custom = selection.custom_size === true;
  if (custom) {
    if (!v.custom_size.enabled) throw invalid("ابعاد سفارشی برای این نوع فعال نیست");
    width = dimension(selection.width_cm); height = dimension(selection.height_cm);
    price = Math.ceil(width * height / 10000 * v.custom_size.price_per_m2);
  }
  const ids = selection.extra_ids ?? [];
  const extras = selectedExtras(v.extras, ids);
  const legacyPrice = price + extras.reduce((sum, e) => sum + e.price, 0);
  const total = price + extras.reduce((sum, e) => sum + e.price * e.quantity, 0);
  if (!Number.isSafeInteger(total) || price < 1 || total > 1000000000) throw invalid("قیمت این ترکیب از محدودهٔ مجاز خارج است؛ ابعاد یا خدمات را تغییر دهید");
  return { price, legacyPrice, selection: { variant_id: v.id, variant_name: v.name, kind: v.kind, width_cm: width, height_cm: height, custom_size: custom, extra_ids: ids, extras, image_path: v.image_path } };
}
module.exports = { normalizeProductOptions, quoteProduct };
