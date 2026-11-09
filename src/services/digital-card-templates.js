const TEMPLATE_CATALOG = [
  { id: "motion", label: "موشن · کاور تمام‌صفحه", free: true },
  { id: "ribbon", label: "ریبون · ستون رنگی", free: true },
  { id: "studio", label: "استودیو · سفید و سبزآبی", free: true },
  { id: "orbit", label: "اوربیت · تم گوشی", free: true },
  { id: "smart", label: "اسمارت · سفید و لیمویی", free: true },
  { id: "formal-premium", label: "رسمی و متمایز", free: true },
  { id: "bright", label: "شاد و روشن", free: true },
  { id: "corporate", label: "رسمی و شرکتی", free: true },
  { id: "minimal", label: "مینیمال", free: true },
  { id: "luxury", label: "لوکس", free: false },
  { id: "shop", label: "فروشگاهی", free: false },
  { id: "medical", label: "پزشکی و خدماتی", free: false },
];
const isTemplateEnabled = (settings, id) => TEMPLATE_CATALOG.some((item) => item.id === id) && settings[`template_${id}_deleted`] !== true && settings[`template_${id}_enabled`] !== false;
const canSelectTemplate = (settings, id, currentTemplate) => id === currentTemplate || isTemplateEnabled(settings, id);
const isTemplateFree = (settings, id) => settings["template_" + id + "_free"] ?? TEMPLATE_CATALOG.find((item) => item.id === id)?.free ?? false;
const adminTemplates = (settings) => TEMPLATE_CATALOG.filter((item) => settings[`template_${item.id}_deleted`] !== true).map((item) => ({ ...item, free: isTemplateFree(settings, item.id), price: Number(settings["template_" + item.id + "_price"] || 0), active: settings["template_" + item.id + "_active"] === true, enabled: isTemplateEnabled(settings, item.id) }));
function validateTemplateUpdates(items) {
  if (!Array.isArray(items) || !items.length || items.length > TEMPLATE_CATALOG.length) return false;
  const seen = new Set();
  return items.every((item) => {
    if (!item || typeof item.id !== "string" || typeof item.enabled !== "boolean" || seen.has(item.id) || !TEMPLATE_CATALOG.some((template) => template.id === item.id)) return false;
    if (["free", "price", "active"].some((key) => key in item) && (typeof item.free !== "boolean" || typeof item.active !== "boolean" || !Number.isSafeInteger(item.price) || item.price < 0 || (!item.free && item.active && item.price < 100))) return false;
    seen.add(item.id);
    return true;
  });
}
module.exports = { TEMPLATE_CATALOG, isTemplateFree, isTemplateEnabled, canSelectTemplate, adminTemplates, validateTemplateUpdates };
