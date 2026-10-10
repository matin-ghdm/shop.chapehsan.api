const express = require("express");
const downloadsService = require("../services/downloads");
const { authenticate } = require("../middleware/auth");

const purchases = require("../services/download-purchases");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      message: "فقط ادمین مجاز است",
      code: "FORBIDDEN",
    });
  }
  next();
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next();
  }
  return authenticate(req, _res, next);
}

// Public list — protected items hide file_path unless logged in
router.get("/", optionalAuth, async (req, res) => {
  try {
    const downloads = await downloadsService.listDownloads({
      type: req.query.type || null,
      includeInactive: req.user?.role === "admin",
    });

    const isLoggedIn = Boolean(req.user);
    res.json({
      downloads: downloads.map((row) =>
        downloadsService.toPublicDownload(row, {
          hideFilePath: req.user?.role !== "admin" && (row.is_paid || (row.requires_login && !isLoggedIn)),
        })
      ),
    });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت دانلودها",
      code: err.code,
    });
  }
});

router.get('/purchases/mine', authenticate, async (req,res) => {
  try {res.json({purchases:await purchases.list(req.user.id)});} catch(err) {res.status(500).json({message:'دریافت خریدها ناموفق بود'});}
});
router.post('/:id/purchase', authenticate, async (req,res) => {
  try {res.json(await purchases.create(req.user.id,req.params.id));} catch(err) {res.status(err.status || 500).json({message:err.message});}
});
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const download = await downloadsService.findById(req.params.id);
    if (!download) {
      return res.status(404).json({ message: "دانلود پیدا نشد", code: "NOT_FOUND" });
    }

    if (!download.is_active && req.user?.role !== "admin") return res.status(404).json({ message: "فایل در دسترس نیست" });
    if (download.requires_login && !req.user) {
      return res.status(401).json({
        message: "برای دسترسی به این فایل باید وارد شوید",
        code: "UNAUTHORIZED",
      });
    }

    res.json({ download: downloadsService.toPublicDownload(download, {hideFilePath: download.is_paid && req.user?.role !== "admin", includeSource:req.user?.role === "admin"}) });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت دانلود",
      code: err.code,
    });
  }
});

router.post("/:id/access", optionalAuth, async (req, res) => {
  try {
    const item = await downloadsService.findById(req.params.id);
    if (!item || (!item.is_active && req.user?.role !== "admin")) return res.status(404).json({message:"فایل در دسترس نیست"});
    if ((item.requires_login || item.is_paid) && !req.user) return res.status(401).json({message:"برای دانلود وارد حساب شوید"});
    if (item.is_paid && req.user?.role !== 'admin' && !(await purchases.owns(req.user.id,item.id))) return res.status(402).json({message:'برای دریافت فایل ابتدا خرید را کامل کنید'});
    if (item.is_paid && !item.file_key) return res.status(503).json({message:'فایل برای دریافت آماده نیست'});
    await require("../db").query("UPDATE downloads SET download_count = download_count + 1 WHERE id=$1", [item.id]);
    res.set("Cache-Control","private, no-store").json({file_path: item.file_path, file_key:item.file_key || undefined, name:item.name,format:item.format});
  } catch (error) { res.status(error.status || 500).json({message:"دریافت فایل ناموفق بود"}); }
});

router.post("/", authenticate, requireAdmin, async (req, res) => {
  try {
    const download = await downloadsService.createDownload(req.body);
    res.status(201).json({ download });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در ایجاد دانلود",
      code: err.code,
    });
  }
});

router.put("/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const download = await downloadsService.updateDownload(req.params.id, req.body);
    res.json({ download });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در بروزرسانی دانلود",
      code: err.code,
    });
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const download = await downloadsService.deleteDownload(req.params.id);
    res.json({ message: "دانلود حذف شد", download });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در حذف دانلود",
      code: err.code,
    });
  }
});

module.exports = router;
