const { test } = require('node:test');
const assert = require('node:assert/strict');
const queries = [];
const variant = {id:'stand',name:'استندی',kind:'stand',image_path:'/stand.jpg',width_cm:90,height_cm:200,price:550000,custom_size:{enabled:false,price_per_m2:0},extras:[{id:'base',name:'فلکه‌ای',price:200000}]};
const client = {release(){},async query(sql,values){
 queries.push(sql);
 if(sql.includes('INSERT INTO orders')) return {rows:[{id:'order',total_price:values[4]}]};
 if(sql.includes('SELECT type, price')) return {rows:[{type:'occasion',price:550000,is_active:true,product_options:{variants:[variant]}}]};
 if(sql.includes('INSERT INTO order_items')) return {rows:[{quantity:values[2],unit_price:values[3],custom_data:JSON.parse(values[4])}]};
 return {rows:[]};
}};
const dbPath=require.resolve('../src/db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{pool:{connect:async()=>client}}};
const {createOrder}=require('../src/services/orders');
const user={id:'user',role:'user'};
const item={design_id:'design',unit_price:750000,quantity:2,custom_data:{productSelection:{variant_id:'stand',extra_ids:['base'],variant_name:'forged',extras:[{price:0}]}}};
test('occasion orders use canonical variant details and preserve the configured extra price',async()=>{
 const order=await createOrder({is_pickup:true,items:[item]},user);
 assert.equal(order.total_price,1500000);
 assert.equal(order.items[0].custom_data.productSelection.variant_name,'استندی');
 assert.equal(order.items[0].custom_data.productSelection.extras[0].price,200000);
});
test('stale prices and underpaid totals roll back instead of creating an order',async()=>{
 await assert.rejects(createOrder({is_pickup:true,items:[{...item,unit_price:1}]},user),{code:'PRICE_CHANGED'});
 assert.equal(queries.at(-1),'ROLLBACK');
 await assert.rejects(createOrder({is_pickup:true,items:[item],total_price:1},user),{code:'VALIDATION_ERROR'});
 assert.equal(queries.at(-1),'ROLLBACK');
});
