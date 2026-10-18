const PANEL_PERMISSIONS = [
  "orders.view",
  "orders.manage",
  "products.manage",
  "slides.manage",
  "downloads.manage",
  "requests.manage",
  "reviews.manage",
  "calendar.manage",
  "discounts.manage",
  "settings.manage",
];

function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((permission) => PANEL_PERMISSIONS.includes(permission)))];
}

function hasPermission(user, permission) {
  if (user?.role === "admin") return true;
  if (String(user?.role || "").trim().toLowerCase() !== "staff") return false;
  const permissions = normalizePermissions(user?.permissions);
  if (permissions.includes(permission)) return true;
  return permission === "orders.view" && permissions.includes("orders.manage");
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ message: "برای این بخش دسترسی ندارید", code: "FORBIDDEN" });
    }
    next();
  };
}

module.exports = { PANEL_PERMISSIONS, normalizePermissions, hasPermission, requirePermission };
