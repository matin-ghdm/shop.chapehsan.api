const assert = require('node:assert/strict');
const {test} = require('node:test');
const calls=[];
let row;
const dbPath=require.resolve('../src/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:async(sql,values)=>{
 calls.push({sql,values});
 if(sql.startsWith('INSERT')) row={id:'test-id',name:values[0],description:values[1],type:values[2],file_path:values[3],format:values[4],is_protected:values[5],is_active:values[6],requires_login:values[7],archive_password:values[8],preview_path:values[9],size_bytes:values[10],download_count:0,dimensions:values[11],software:values[12],usage_guide:values[13],usage_terms:values[14]};
 if(sql.startsWith('UPDATE')) {
   for(const match of sql.matchAll(/(is_active|requires_login|archive_password|preview_path|size_bytes|name|file_path|dimensions|software|usage_guide|usage_terms) = \$(\d+)/g)) row[match[1]]=values[Number(match[2])-1];
   if(sql.includes('download_count + 1')) row.download_count++;
 }
 return {rows:row?[{...row}]:[]};
}}};
const service=require('../src/services/downloads');
test('download management persists metadata, validates input and enforces access',async t=>{
 for(const type of ['layer','pdf','image','banner','tasliat','map','other']) {
  const item=await service.createDownload({name:'فایل',type,file_path:'/uploads/test.zip',is_active:false,requires_login:true,archive_password:'archive',preview_path:'/preview.jpg',size_bytes:42,dimensions:'300 × 100 cm',software:'Photoshop',usage_guide:'Edit layers',usage_terms:'Personal use'});
  assert.equal(item.type,type);assert.equal(item.is_active,false);assert.equal(item.archive_password,'archive');assert.equal(item.size_bytes,42);assert.equal(item.software,'Photoshop');assert.equal(item.usage_terms,'Personal use');
 }
 await service.updateDownload('test-id',{is_active:true,name:'نام جدید',file_path:'https://example.com/new.zip',requires_login:false,usage_guide:'Updated guide'});
 const saved=await service.findById('test-id');assert.equal(saved.name,'نام جدید');assert.equal(saved.preview_path,'/preview.jpg');assert.equal(saved.requires_login,false);assert.equal(saved.usage_guide,'Updated guide');
 await service.listDownloads();assert.match(calls.at(-1).sql,/is_active = TRUE/);
 await service.listDownloads({includeInactive:true});assert.doesNotMatch(calls.at(-1).sql,/is_active = TRUE/);
 assert.equal(service.toPublicDownload(saved,{hideFilePath:true}).file_path,undefined);
 for(const payload of [{name:' '},{file_path:'javascript:alert(1)'},{file_path:'//example.com/x'},{size_bytes:-1},{requires_login:'false'},{type:'bad'}]) await assert.rejects(service.updateDownload('test-id',payload));
 const authPath=require.resolve('../src/middleware/auth');
 require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{authenticate:(req,res,next)=>{if(req.headers.authorization==='Bearer test-admin') {req.user={role:'admin'};next();}else res.sendStatus(401);}}};
 const express=require('express');const app=express();app.use(express.json());app.use('/downloads',require('../src/routes/downloads'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/downloads`;
 try {
  row.is_active=false;let response=await fetch(base+'/test-id/access',{method:'POST'});assert.equal(response.status,404);assert.equal(row.download_count,0);
  row.is_active=true;row.requires_login=true;response=await fetch(base+'/test-id/access',{method:'POST'});assert.equal(response.status,401);assert.equal(row.download_count,0);
  response=await fetch(base);assert.equal((await response.json()).downloads[0].file_path,undefined);
  response=await fetch(base+'/test-id/access',{method:'POST',headers:{Authorization:'Bearer test-admin'}});assert.equal(response.status,200);assert.equal((await response.json()).file_path,row.file_path);assert.equal(row.download_count,1);
  response=await fetch(base+'/test-id',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"name":"unauthorized"}'});assert.equal(response.status,401);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
