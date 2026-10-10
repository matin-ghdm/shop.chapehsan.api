const {test}=require('node:test');const assert=require('node:assert/strict');
let row={id:'file-id',name:'Map',is_active:true,is_paid:true,price:380000,file_key:'a'.repeat(64),file_path:'https://test.public.blob.vercel-storage.com/downloads-private/test.bin',download_count:0};
let owned=false,verifyResult={result:202},paid=false;
const calls=[];
function mock(name,exports){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};}
mock('../src/db',{query:async(sql,values)=>{calls.push({sql,values});if(sql.includes('WITH paid AS'))paid=true;if(sql.includes('payment_track_id = $1')&&sql.startsWith('SELECT'))return {rows:[{id:'order-id',total_price:380000,status:'awaiting_payment'}]};return {rows:[row],rowCount:1};}});
mock('../src/services/download-purchases',{owns:async()=>owned,list:async()=>[],create:async()=>({orderId:'order-id'})});
mock('../src/services/orders',{getOrderWithItems:async()=>({id:'order-id',total_price:380000,status:'awaiting_payment'}),assertOrderAccess:()=>{}});
mock('../src/services/zibal',{verifyPayment:async()=>verifyResult,VERIFY_RESULT_FA:{}});
mock('../src/middleware/auth',{authenticate:(req,res,next)=>{if(req.headers.authorization){req.user={id:'buyer',role:req.headers.authorization==='Bearer admin'?'admin':'user'};next();}else res.sendStatus(401);}});
const downloads=require('../src/services/downloads');
test('paid download metadata never exposes encryption keys and rejects invalid prices or unprotected storage',async()=>{
 const publicItem=downloads.toPublicDownload(row,{hideFilePath:true});assert.equal(publicItem.file_key,undefined);assert.equal(publicItem.file_path,undefined);assert.equal(publicItem.price,380000);
 for(const payload of [{is_paid:true,price:0},{price:-1},{price:1.5},{price:'wrong'},{file_path:'https://example.com/public.rar'}]) await assert.rejects(downloads.updateDownload('file-id',payload));
 const old=row;row={...row,file_key:null};await assert.rejects(downloads.updateDownload('file-id',{is_paid:true,price:380000}));row=old;
});
test('paid files require verified purchase; gateway failure and amount mismatch never grant access',async()=>{
 const express=require('express'),app=express();app.use(express.json());app.use('/downloads',require('../src/routes/downloads'));app.use('/payments',require('../src/routes/payments'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try {
  let response=await fetch(base+'/downloads/file-id/access',{method:'POST'});assert.equal(response.status,401);
  response=await fetch(base+'/downloads/file-id/access',{method:'POST',headers:{Authorization:'Bearer buyer'}});assert.equal(response.status,402);
  response=await fetch(base+'/downloads',{headers:{Authorization:'Bearer buyer'}});const item=(await response.json()).downloads[0];assert.equal(item.file_path,undefined);assert.equal(item.file_key,undefined);
  const verify=()=>fetch(base+'/payments/zibal/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackId:123,success:1})});
  response=await verify();assert.equal((await response.json()).ok,false);assert.equal(paid,false);
  verifyResult={result:100,amount:1000};response=await verify();assert.equal(response.status,400);assert.equal(paid,false);
  verifyResult={result:100,amount:3800000,refNumber:456};response=await verify();assert.equal((await response.json()).ok,true);assert.equal(paid,true);
  owned=true;response=await fetch(base+'/downloads/file-id/access',{method:'POST',headers:{Authorization:'Bearer buyer'}});assert.equal(response.status,200);assert.equal((await response.json()).file_key,row.file_key);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
