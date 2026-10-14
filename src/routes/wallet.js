const express = require("express");
const { authenticate } = require("../middleware/auth");
const walletService = require("../services/wallet");

const router = express.Router();
router.use(authenticate);

router.get("/", async (req, res) => {
  try {
    res.json(await walletService.getWallet(req.user.id));
  } catch (err) {
    res.status(500).json({ message: err.message || "دریافت کیف پول ناموفق بود" });
  }
});

module.exports = router;
