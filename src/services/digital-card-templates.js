const TEMPLATE_CATALOG = [
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
const isTemplateEnabled = (settings, id) => TEMPLATE_CATALOG.some((item) => item.id === id) && settings[`template_${id}_enabled`] !== false;
const canSelectTemplate = (settings, id, currentTemplate) => id === currentTemplate || isTemplateEnabled(settings, id);
const adminTemplates = (settings) => TEMPLATE_CATALOG.map((item) => ({ ...item, enabled: isTemplateEnabled(settings, item.id) }));
function validateTemplateUpdates(items) {
  if (!Array.isArray(items) || !items.length || items.length > TEMPLATE_CATALOG.length) return false;
  const seen = new Set();
  return items.every((item) => {
    if (!item || typeof item.id !== "string" || typeof item.enabled !== "boolean" || seen.has(item.id) || !TEMPLATE_CATALOG.some((template) => template.id === item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
module.exports = { TEMPLATE_CATALOG, isTemplateEnabled, canSelectTemplate, adminTemplates, validateTemplateUpdates };
