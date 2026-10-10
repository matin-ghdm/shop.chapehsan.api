const {pool, query} = require('../db');
function error(message, status=400) {return Object.assign(new Error(message), {status});}
async function owns(userId, downloadId) {
  const result=await query('SELECT 1 FROM download_purchases WHERE user_id=$1 AND download_id=$2 AND paid_at IS NOT NULL LIMIT 1',[userId,downloadId]);
  return result.rowCount>0;
}
async function list(userId) {
  const result=await query(`SELECT p.order_id,p.download_id,p.name,p.amount,p.paid_at,d.preview_path,d.format,d.is_active
    FROM download_purchases p JOIN downloads d ON d.id=p.download_id
    WHERE p.user_id=$1 AND p.paid_at IS NOT NULL ORDER BY p.paid_at DESC`,[userId]);
  return result.rows;
}
async function create(userId, downloadId) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize checkout for a user so double clicks reuse the same unpaid order.
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const {rows:[item]}=await client.query('SELECT * FROM downloads WHERE id=$1 FOR SHARE',[downloadId]);
    if(!item || !item.is_active) throw error('فایل در دسترس نیست',404);
    if(!item.is_paid || Number(item.price)<100 || !item.file_key) throw error('این فایل برای خرید آماده نیست');
    const owned=await client.query('SELECT 1 FROM download_purchases WHERE user_id=$1 AND download_id=$2 AND paid_at IS NOT NULL',[userId,downloadId]);
    if(owned.rowCount) {await client.query('COMMIT');return {owned:true};}
    const pending=await client.query(`SELECT p.order_id FROM download_purchases p JOIN orders o ON o.id=p.order_id
      WHERE p.user_id=$1 AND p.download_id=$2 AND p.amount=$3 AND p.paid_at IS NULL AND o.status='awaiting_payment'
      ORDER BY p.created_at DESC LIMIT 1`,[userId,downloadId,item.price]);
    let orderId=pending.rows[0]?.order_id;
    if(!orderId) {
      const order=await client.query(`INSERT INTO orders(user_id,is_pickup,status,total_price,note) VALUES($1,TRUE,'awaiting_payment',$2,$3) RETURNING id`,[userId,item.price,`خرید فایل دیجیتال: ${item.name}`]);
      orderId=order.rows[0].id;
      await client.query('INSERT INTO download_purchases(order_id,download_id,user_id,amount,name) VALUES($1,$2,$3,$4,$5)',[orderId,downloadId,userId,item.price,item.name]);
    }
    await client.query('COMMIT');return {orderId,amount:Number(item.price)};
  } catch(err) {await client.query('ROLLBACK');throw err;} finally {client.release();}
}
module.exports={owns,list,create};
