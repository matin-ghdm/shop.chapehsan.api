const test = require('node:test');
const assert = require('node:assert/strict');
let order, updates, refunded;
const client = {
  async query(sql, values) {
    if (sql.includes('FOR UPDATE') && sql.includes('FROM orders')) return { rows: [order] };
    if (sql.startsWith('UPDATE orders')) {
      assert.deepEqual(values, ['canceled', 'customer', 'order-1']);
      assert.match(sql, /WHERE id = \$3/);
      updates++;
      order = { ...order, status: 'canceled', canceled_by: order.canceled_by || values[1] };
      return { rows: [order] };
    }
    return { rows: [] };
  }, release() {}
};
require.cache[require.resolve('../src/db')] = { exports: {
  pool: { connect: async () => client },
  query: async sql => sql.includes('download_purchases WHERE order_id') ? { rowCount: 0, rows: [] } : { rows: [order] }
} };
require.cache[require.resolve('../src/services/wallet')] = { exports: { addTransaction: async () => { refunded++; } } };
const { updateOrder } = require('../src/services/orders');
test('customer cancellation checks owner and locked payment status, refunds once, and records actor', async () => {
  const reset = () => { order = { id: 'order-1', user_id: 'owner', status: 'awaiting_payment', is_pickup: true, wallet_amount: 100 }; updates = 0; refunded = 0; };
  reset();
  await assert.rejects(updateOrder('order-1', {status:'canceled'}, {customerId:'other'}), e => e.status === 403);
  assert.equal(updates, 0);
  reset(); order.status = 'paid'; order.paid_at = 'now';
  await assert.rejects(updateOrder('order-1', {status:'canceled'}, {customerId:'owner'}), e => e.status === 409);
  assert.equal(updates, 0);
  reset();
  const result = await updateOrder('order-1', {status:'canceled'}, {customerId:'owner'});
  assert.equal(result.canceled_by, 'customer');
  assert.equal(refunded, 1);
  await updateOrder('order-1', {status:'canceled'}, {customerId:'owner'});
  assert.equal(refunded, 1);
});
