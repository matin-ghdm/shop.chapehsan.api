const express = require("express");
const usersService = require("../services/users");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (_req, res) => {
  try {
    const users = await usersService.listUsers();
    res.json({ users });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "Failed to list users",
    });
  }
});

router.post("/register", async (req, res) => {
  try {
    console.log("REGISTER body:", JSON.stringify(req.body));
    const result = await usersService.register(req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error("REGISTER failed:", err.code || err.status, err.message);
    res.status(err.status || 500).json({
      message: err.message || "ثبت‌نام ناموفق بود",
      code: err.code || "REGISTER_FAILED",
      fields: err.fields || undefined,
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const result = await usersService.login(req.body);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "ورود ناموفق بود",
    });
  }
});

router.get("/me", authenticate, async (req, res) => {
  res.json({ user: req.user });
});

router.get("/:id", authenticate, async (req, res) => {
  try {
    const user = await usersService.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ user: usersService.toPublicUser(user) });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "Failed to get user",
    });
  }
});

router.put("/:id", authenticate, async (req, res) => {
  try {
    if (req.user.id !== req.params.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const payload = { ...(req.body || {}) };
    // Only admins may change roles (prevents self-escalation).
    if (req.user.role !== "admin") {
      delete payload.role;
    }

    const user = await usersService.updateUser(req.params.id, payload);
    res.json({ user });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "Update failed",
    });
  }
});

router.delete("/:id", authenticate, async (req, res) => {
  try {
    if (req.user.id !== req.params.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const user = await usersService.deleteUser(req.params.id);
    res.json({ message: "User deleted", user });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "Delete failed",
    });
  }
});

module.exports = router;
