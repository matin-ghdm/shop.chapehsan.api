const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
require("dotenv").config();

const { query, testConnection } = require("./db");
const swaggerSpec = require("./swagger");
const usersRouter = require("./routes/users");
const ordersRouter = require("./routes/orders");
const orderItemsRouter = require("./routes/orderItems");
const addressesRouter = require("./routes/addresses");
const slidesRouter = require("./routes/slides");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/users", usersRouter);
app.use("/otp", require("./routes/otp"));
app.use("/orders", ordersRouter);
app.use("/order-items", orderItemsRouter);
app.use("/addresses", addressesRouter);
app.use("/slides", slidesRouter);
app.use("/downloads", require("./routes/downloads"));
app.use("/designs", require("./routes/designs"));
app.use("/occasion-calendar", require("./routes/occasion-calendar"));
app.use("/favorites", require("./routes/favorites"));
app.use("/admin", require("./routes/admin"));
app.use("/reviews", require("./routes/reviews"));
app.use("/payments", require("./routes/payments"));
app.use("/discount-codes", require("./routes/discount-codes"));
app.use("/wallet", require("./routes/wallet"));

/**
 * @openapi
 * /:
 *   get:
 *     summary: Root endpoint
 *     description: Returns API status and connected database name
 *     tags:
 *       - General
 *     responses:
 *       200:
 *         description: API is running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: ch-back API is running
 *                 database:
 *                   type: string
 *                   example: chapehsan
 */
app.get("/", (_req, res) => {
  res.json({
    message: "ch-back API is running",
    database: process.env.DB_NAME || "chapehsan",
  });
});

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Tests PostgreSQL connection and returns server time
 *     tags:
 *       - General
 *     responses:
 *       200:
 *         description: Database connection is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 database:
 *                   type: string
 *                   example: chapehsan
 *                 serverTime:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Database connection failed
 */
app.get("/health", async (_req, res) => {
  try {
    const info = await testConnection();
    res.json({
      status: "ok",
      database: info.database,
      serverTime: info.now,
    });
  } catch (err) {
    console.error("Health check failed:", err.message);
    res.status(500).json({
      status: "error",
      message: "Database connection failed",
      detail: err.message,
    });
  }
});

/**
 * @openapi
 * /tables:
 *   get:
 *     summary: List database tables
 *     description: Returns all user tables from the chapehsan database
 *     tags:
 *       - Database
 *     responses:
 *       200:
 *         description: List of tables
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tables:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       table_schema:
 *                         type: string
 *                         example: public
 *                       table_name:
 *                         type: string
 *                         example: users
 *       500:
 *         description: Failed to list tables
 */
app.get("/tables", async (_req, res) => {
  try {
    const result = await query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);
    res.json({ tables: result.rows });
  } catch (err) {
    console.error("List tables failed:", err.message);
    res.status(500).json({
      message: "Failed to list tables",
      detail: err.message,
    });
  }
});

async function startServer() {
  const { ensureDesignImagesColumn } = require("./migrations/ensure-design-images");
  await ensureDesignImagesColumn();
  const { ensureDesignBannerTextColumn } = require("./migrations/ensure-design-banner-text");
  await ensureDesignBannerTextColumn();
  await require("./migrations/ensure-product-options").ensureProductOptions();
  await require("./migrations/ensure-occasion-calendar").ensureOccasionCalendar();
  await require("./migrations/ensure-design-updated-at").ensureDesignUpdatedAtColumn();
  await require("./migrations/ensure-download-management").ensureDownloadManagement();
  await require("./migrations/ensure-discount-codes").ensureDiscountCodes();
  await require("./migrations/ensure-wallet").ensureWallet();
  app.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
  try {
    const { ensureOrderPaymentColumns } = require("./migrations/ensure-order-payments");
    await ensureOrderPaymentColumns();
    console.log("Order payment columns ensured");
  } catch (err) {
    console.error("Could not ensure payment columns:", err.message);
  }
  try {
    const { ensureOtpCodesTable } = require("./migrations/ensure-otp-codes");
    await ensureOtpCodesTable();
    console.log("OTP codes table ensured");
  } catch (err) {
    console.error("Could not ensure OTP table:", err.message);
  }
  try {
    const { ensureUserFavoritesTable } = require("./migrations/ensure-user-favorites");
    await ensureUserFavoritesTable();
    console.log("User favorites table ensured");
  } catch (err) {
    console.error("Could not ensure favorites table:", err.message);
  }
  try {
    const { ensureProductReviewsTable } = require("./migrations/ensure-product-reviews");
    await ensureProductReviewsTable();
    console.log("Product reviews table ensured");
  } catch (err) {
    console.error("Could not ensure product reviews table:", err.message);
  }
  try {
    const info = await testConnection();
    console.log(`Connected to database "${info.database}" at ${info.now}`);
  } catch (err) {
    console.error("Could not connect to PostgreSQL:", err.message);
  }
  });
}

startServer().catch((err) => {
  console.error("Could not prepare design images:", err.message);
  process.exitCode = 1;
});
