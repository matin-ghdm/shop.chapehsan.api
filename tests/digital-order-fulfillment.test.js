const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const back=require('node:path').resolve(__dirname,'..');
function load(file,req){const module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:req,console,Intl,Date,setInterval,clearInterval});return module.exports;}
(async()=>{
 const calls=[];let kind='subscription',sent=0,activated=true;
 const detail={id:'event',kind:'subscription_paid',phone:'fixture',title:'چاپ احسان',attempts:1,subscription:{plan_code:'bronze',months:12,starts_at:'2026-11-17',ends_at:'2027-11-17'}};
 const query=async(sql,params)=>{
  calls.push(sql);
  if(sql.includes('digital_card_settings'))return {rows:[['sms_enabled',true],['sms_template_id',12]].map(([key,value])=>({key,value}))};
  if(sql.includes('SELECT n.id,n.card_id'))return {rows:[{...detail,subscription:activated?detail.subscription:null}]};
  if(sql.includes('RETURNING n.id'))return {rows:[{id:'event'}],rowCount:1};
  if(sql.startsWith('SELECT 1 FROM download_purchases'))return {rows:[],rowCount:kind==='physical'?0:1};
  if(sql.includes('FROM orders o'))return {rows:[{id:'id',is_pickup:true,status:'confirmed'}]};
  return {rows:[],rowCount:0};
 };
 const req=n=>n==='../db'?{query,pool:{connect:async()=>({query,release(){}})}}:n==='./smsir'?{sendTemplate:async()=>{sent++;return {};}}:n==='../lib/panel-permissions'?{hasPermission:()=>true}:{};
 const orders=load(back+'/src/services/orders.js',req);
 for(kind of ['subscription','template','download'])await assert.rejects(orders.updateOrder('id',{status:'printing'}),e=>e.code==='DIGITAL_ORDER_AUTOMATIC');
 await orders.getOrderWithItems('id');
 assert(calls.some(s=>s.includes('AS fulfillment_type')&&s.includes('AS subscription')));
 const notify=load(back+'/src/services/digital-card-notifications.js',req);
 const text=notify.buildMessage('subscription_paid','چاپ\nاحسان',detail.subscription);
 assert(text.includes('برنزی')&&text.includes('۱۲')&&text.includes('پایان اعتبار'));
 await notify.runDigitalCardNotificationWorker();assert.equal(sent,1);
 activated=false;await notify.runDigitalCardNotificationWorker();assert.equal(sent,1);
 assert(calls.some(s=>s.includes("status='skipped'")&&s.includes('activation not confirmed')));
 console.log('PASS: digital order mutation guards, SQL classification and activation SMS without external connections.');
})().catch(e=>{console.error(e);process.exitCode=1;});
