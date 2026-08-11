const express = require("express");
const downloadsService = require("../services/downloads");
const { authenticate } = require("../middleware/auth");

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
    });

    const isLoggedIn = Boolean(req.user);
    res.json({
      downloads: downloads.map((row) =>
        downloadsService.toPublicDownload(row, {
          hideFilePath: row.is_protected && !isLoggedIn,
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

router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const download = await downloadsService.findById(req.params.id);
    if (!download) {
      return res.status(404).json({ message: "دانلود پیدا نشد", code: "NOT_FOUND" });
    }

    if (download.is_protected && !req.user) {
      return res.status(401).json({
        message: "برای دسترسی به این فایل باید وارد شوید",
        code: "UNAUTHORIZED",
      });
    }

    res.json({ download: downloadsService.toPublicDownload(download) });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "خطا در دریافت دانلود",
      code: err.code,
    });
  }
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
