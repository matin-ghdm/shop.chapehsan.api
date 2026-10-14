const { query } = require("../db");

async function getBalance(userId, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    "SELECT COALESCE(SUM(amount), 0)::bigint AS balance FROM wallet_transactions WHERE user_id = $1",
    [userId],
  );
  return Number(result.rows[0]?.balance || 0);
}

async function addTransaction(client, { userId, orderId, type, amount }) {
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new Error("مبلغ تراکنش کیف پول معتبر نیست");
  }
  const result = await client.query(
    `INSERT INTO wallet_transactions (user_id, order_id, type, amount)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [userId, orderId, type, amount],
  );
  return result.rowCount > 0;
}

async function getWallet(userId) {
  const [balance, transactions] = await Promise.all([
    getBalance(userId),
    query(
      `SELECT id::text AS id, order_id, type, amount::float8 AS amount, created_at
       FROM wallet_transactions WHERE user_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [userId],
    ),
  ]);
  return { balance, transactions: transactions.rows };
}

module.exports = { getBalance, addTransaction, getWallet };
