require("dotenv").config();
const { ensureOrderPaymentColumns } = require("../src/migrations/ensure-order-payments");

ensureOrderPaymentColumns()
  .then(() => {
    console.log("orders payment columns ready");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
