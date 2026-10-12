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
function normalizeProductOptions(input) {
  if (input == null) return { variants: [] };
  if (!Array.isArray(input.variants) || input.variants.length > 12) throw invalid("حداکثر ۱۲ نوع برای هر محصول مجاز است");
  const ids = new Set();
  return { variants: input.variants.map(v => {
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
  }) };
}
function quoteProduct(design, selection) {
  const variants = normalizeProductOptions(design.product_options).variants;
  if (!variants.length) {
    if (selection?.variant_id || selection?.extra_ids?.length || selection?.custom_size) throw invalid("این محصول گزینهٔ سفارشی ندارد");
    return { price: amount(design.price, true), selection: null };
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
  if (!Array.isArray(ids) || ids.length > 20 || new Set(ids).size !== ids.length) throw invalid("خدمات انتخاب‌شده معتبر نیست");
  const extras = ids.map(id => {
    const e = v.extras.find(e => e.id === id);
    if (!e) throw invalid("خدمت انتخاب‌شده برای این نوع موجود نیست");
    return e;
  });
  price += extras.reduce((sum, e) => sum + e.price, 0);
  if (!Number.isSafeInteger(price) || price < 1 || price > 1000000000) throw invalid("قیمت این ترکیب از محدودهٔ مجاز خارج است؛ ابعاد یا خدمات را تغییر دهید");
  return { price, selection: { variant_id: v.id, variant_name: v.name, kind: v.kind, width_cm: width, height_cm: height, custom_size: custom, extra_ids: ids, extras, image_path: v.image_path } };
}
module.exports = { normalizeProductOptions, quoteProduct };
