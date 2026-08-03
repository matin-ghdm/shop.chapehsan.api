const jwt = require("jsonwebtoken");
const { JWT_SECRET, findById, toPublicUser } = require("../services/users");

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token required" });
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await findById(payload.id);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    req.user = toPublicUser(user);
    next();
  } catch (_err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = { authenticate };
