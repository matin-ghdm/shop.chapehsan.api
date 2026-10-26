const TIERS = ["bronze", "silver", "gold"];

const DEFAULT_PLANS = {
  bronze: {
    label: "برنزی",
    limits: { activeCards: 1, phonesPerCard: 3, linksPerCard: 5, addressesPerCard: 1, servicesPerCard: 0, galleryImagesPerCard: 0, productsPerCard: 0, catalogsPerCard: 0, storageMb: 20 },
    features: { fullAnalytics: false, categories: false, whatsappCta: false, leadForms: false, allTemplates: false },
  },
  silver: {
    label: "نقره‌ای",
    limits: { activeCards: 5, phonesPerCard: 6, linksPerCard: 10, addressesPerCard: 3, servicesPerCard: 10, galleryImagesPerCard: 6, productsPerCard: 0, catalogsPerCard: 0, storageMb: 150 },
    features: { fullAnalytics: true, categories: false, whatsappCta: false, leadForms: false, allTemplates: true },
  },
  gold: {
    label: "طلایی",
    limits: { activeCards: 15, phonesPerCard: 10, linksPerCard: 20, addressesPerCard: 10, servicesPerCard: 30, galleryImagesPerCard: 30, productsPerCard: 20, catalogsPerCard: 3, storageMb: 500 },
    features: { fullAnalytics: true, categories: true, whatsappCta: true, leadForms: true, allTemplates: true },
  },
};

const LIMIT_KEYS = Object.keys(DEFAULT_PLANS.bronze.limits);
const FEATURE_KEYS = Object.keys(DEFAULT_PLANS.bronze.features);
const LEGACY_SOCIAL_KEYS = ["whatsapp", "telegram", "instagram", "eitaa", "rubika", "bale", "soroush", "gap", "igap", "shad", "linkedin", "aparat", "x", "facebook", "youtube", "tiktok", "snapchat", "discord", "signal"];

function asLimit(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 100000 ? number : fallback;
}

function asPrice(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function planSnapshot(settings = {}, tier = "bronze") {
  const code = TIERS.includes(tier) ? tier : "bronze";
  const defaults = DEFAULT_PLANS[code];
  const limits = Object.fromEntries(LIMIT_KEYS.map((key) => [key, asLimit(settings[`plan_${code}_${key}`], defaults.limits[key])]));
  const features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, typeof settings[`plan_${code}_${key}`] === "boolean" ? settings[`plan_${code}_${key}`] : defaults.features[key]]));
  return { tier: code, label: defaults.label, limits, features };
}

function planPrice(settings = {}, tier, months) {
  const code = TIERS.includes(tier) ? tier : "bronze";
  const duration = [6, 12].includes(Number(months)) ? Number(months) : 0;
  if (!duration) return { price: 0, active: false };
  const legacyKey = `plan_${duration}_price`;
  const key = `plan_${code}_${duration}_price`;
  const activeKey = `plan_${code}_${duration}_active`;
  const price = settings[key] == null && code === "bronze" ? settings[legacyKey] : settings[key];
  const active = settings[activeKey] == null ? (code === "bronze" ? settings[`plan_${duration}_active`] !== false : false) : settings[activeKey] === true;
  return { price: asPrice(price), active };
}

function dataCounts(data = {}) {
  const socials = Array.isArray(data.socialLinks) ? data.socialLinks : LEGACY_SOCIAL_KEYS.filter((key) => data[key]).map((key) => data[key]);
  const links = [
    ...socials,
    ...(Array.isArray(data.customLinks) ? data.customLinks : []),
    ...(Array.isArray(data.portfolio) ? data.portfolio : []),
    ...(data.website ? [data.website] : []),
    ...(data.shopLink ? [data.shopLink] : []),
  ];
  return {
    phonesPerCard: (Array.isArray(data.phones) ? data.phones.length : 0) + Number(Boolean(data.fax && !(Array.isArray(data.phones) && data.phones.some((phone) => phone?.kind === "fax" && phone.value === data.fax)))),
    linksPerCard: links.length,
    addressesPerCard: Array.isArray(data.addresses) ? data.addresses.length : (data.address ? 1 : 0),
    servicesPerCard: Array.isArray(data.services) ? data.services.length : 0,
    galleryImagesPerCard: Array.isArray(data.gallery) ? data.gallery.length : 0,
    productsPerCard: Array.isArray(data.products) ? data.products.length : 0,
    catalogsPerCard: (Array.isArray(data.catalogs) ? data.catalogs.length : 0) + Number(Boolean(data.catalog && !(Array.isArray(data.catalogs) && data.catalogs.some((catalog) => catalog?.url === data.catalog)))),
  };
}

function validateCardDataShape(data = {}) {
  const errors = [];
  const arrays = ["phones", "socialLinks", "addresses", "customLinks", "portfolio", "services", "gallery", "products", "catalogs", "productCategories", "paymentAccounts", "hoursSchedule"];
  for (const [key, value] of Object.entries(data)) {
    if (value != null && typeof value === "object" && !Array.isArray(value)) errors.push({ field: key, reason: "invalid_value" });
    if (typeof value === "string" && value.length > 10000) errors.push({ field: key, reason: "value_too_long" });
  }
  for (const key of arrays) {
    if (data[key] == null) continue;
    if (!Array.isArray(data[key]) || data[key].length > 1000) { errors.push({ field: key, reason: "invalid_array" }); continue; }
    if (key === "productCategories") {
      if (data[key].some((value) => typeof value !== "string" || value.length > 80)) errors.push({ field: key, reason: "invalid_item" });
      continue;
    }
    if (data[key].some((item) => !item || typeof item !== "object" || Array.isArray(item) || Object.values(item).some((value) => typeof value !== "string" && typeof value !== "boolean" && value != null))) {
      errors.push({ field: key, reason: "invalid_item" });
    } else if (data[key].some((item) => Object.values(item).some((value) => typeof value === "string" && value.length > 2000))) {
      errors.push({ field: key, reason: "item_too_long" });
    }
  }
  return errors;
}

function validateCardData(data = {}, previous = {}, plan = planSnapshot()) {
  const nextCounts = dataCounts(data);
  const oldCounts = dataCounts(previous);
  const errors = [];
  for (const [key, count] of Object.entries(nextCounts)) {
    const cap = plan.limits[key];
    if (count > cap && count > oldCounts[key]) errors.push({ field: key, limit: cap, actual: count });
  }
  for (const key of ["whatsappCtaEnabled", "leadFormEnabled"]) {
    const featureKey = key === "whatsappCtaEnabled" ? "whatsappCta" : "leadForms";
    if (data[key] === true && previous[key] !== true && !plan.features[featureKey]) errors.push({ field: key, feature: featureKey });
  }
  const categories = Array.isArray(data.productCategories) ? data.productCategories.length : 0;
  const oldCategories = Array.isArray(previous.productCategories) ? previous.productCategories.length : 0;
  if (categories > oldCategories && !plan.features.categories) errors.push({ field: "productCategories", feature: "categories" });
  return errors;
}

function publicCardData(data = {}, plan = planSnapshot()) {
  const result = { ...data };
  const slice = (value, limit) => Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, limit) : [];
  result.phones = slice(data.phones, plan.limits.phonesPerCard);
  if (data.fax && !result.phones.some((phone) => phone?.kind === "fax" && phone.value === data.fax)) {
    if (result.phones.length >= plan.limits.phonesPerCard) delete result.fax;
  }
  let linkCap = plan.limits.linksPerCard;
  const socials = Array.isArray(data.socialLinks) ? data.socialLinks : LEGACY_SOCIAL_KEYS.filter((key) => data[key]).map((platform) => ({ platform, label: platform, value: data[platform], visible: true }));
  result.socialLinks = slice(socials, linkCap);
  linkCap = Math.max(0, linkCap - result.socialLinks.length);
  if (result.website && linkCap > 0) linkCap--;
  else if (result.website) delete result.website;
  if (result.shopLink && linkCap > 0) linkCap--;
  else if (result.shopLink) delete result.shopLink;
  result.customLinks = slice(data.customLinks, linkCap);
  linkCap = Math.max(0, linkCap - result.customLinks.length);
  result.portfolio = slice(data.portfolio, linkCap);
  for (const key of LEGACY_SOCIAL_KEYS) delete result[key];
  result.addresses = slice(data.addresses, plan.limits.addressesPerCard);
  result.services = slice(data.services, plan.limits.servicesPerCard);
  result.gallery = slice(data.gallery, plan.limits.galleryImagesPerCard);
  result.products = slice(data.products, plan.limits.productsPerCard);
  const sourceCatalogs = slice(data.catalogs, Number.MAX_SAFE_INTEGER);
  const catalogIsListed = Boolean(data.catalog && sourceCatalogs.some((catalog) => catalog.url === data.catalog));
  const legacyCatalogConsumesSlot = Boolean(data.catalog && !catalogIsListed);
  result.catalogs = slice(sourceCatalogs, Math.max(0, plan.limits.catalogsPerCard - Number(legacyCatalogConsumesSlot)));
  if (!plan.limits.catalogsPerCard || catalogIsListed) delete result.catalog;
  if (data.address && !result.addresses.length && plan.limits.addressesPerCard > 0) {
    result.addresses = [{ label: "نشانی", value: data.address, map: data.map, postalCode: data.postalCode, visible: true }];
  }
  if (!plan.features.categories) delete result.productCategories;
  if (!plan.features.whatsappCta) { delete result.whatsappCtaEnabled; delete result.whatsappCtaMessage; }
  if (!plan.features.leadForms) result.leadFormEnabled = false;
  return result;
}

function publicPlans(settings = {}) {
  return TIERS.map((tier) => {
    const snapshot = planSnapshot(settings, tier);
    return {
      code: tier,
      label: snapshot.label,
      limits: snapshot.limits,
      features: snapshot.features,
      durations: [6, 12].map((months) => ({ months, ...planPrice(settings, tier, months) })),
    };
  });
}

module.exports = { TIERS, DEFAULT_PLANS, planSnapshot, planPrice, publicPlans, dataCounts, validateCardDataShape, validateCardData, publicCardData };
