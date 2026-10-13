const {test}=require('node:test');const assert=require('node:assert/strict');
const {schedule,jalaliOrdinal,todayOrdinal,validate}=require('../src/services/occasion-calendar');
const event={title:'مناسبت آزمایشی',message:'روز شما گرامی باد',kind:'congratulation',date_mode:'once',event_date:'2026-10-14',jalali_month:null,jalali_day:null,before_days:3,after_days:0,priority:0,is_active:true,link_url:'/melli-mazhabi',link_label:'مشاهده طرح‌ها'};
test('display window includes the whole event day in Tehran and excludes the following day',()=>{
 assert.equal(schedule(event,new Date('2026-10-10T20:29:59Z')).status,'upcoming');
 assert.equal(schedule(event,new Date('2026-10-10T20:30:00Z')).status,'showing');
 assert.equal(schedule(event,new Date('2026-10-14T20:29:59Z')).status,'showing');
 assert.equal(schedule(event,new Date('2026-10-14T20:30:00Z')).status,'past');
 assert.equal(schedule({...event,is_active:false},new Date('2026-10-12T12:00:00Z')).status,'inactive');
 assert.equal(schedule({...event,after_days:2},new Date('2026-10-16T12:00:00Z')).status,'showing');
});
test('annual Solar Hijri dates repeat across Nowruz and leap day is not silently shifted',()=>{
 const annual={...event,date_mode:'jalali_annual',jalali_month:1,jalali_day:1};
 const day=jalaliOrdinal(1405,1,1);assert.ok(day!==null);
 const now=new Date((day-2)*86400000+12*3600000);
 assert.equal(schedule(annual,now).status,'showing');
 assert.equal(schedule(annual,now).occurrence_date,new Date(day*86400000).toISOString().slice(0,10));
 assert.equal(jalaliOrdinal(1404,12,30),null);
 const leap=schedule({...annual,jalali_month:12,jalali_day:30},new Date('2026-10-12T12:00:00Z'));
 assert.ok(leap.occurrence_date>'2026-10-12');
 assert.equal(todayOrdinal(new Date('2026-10-12T21:00:00Z')),Date.parse('2026-10-13T00:00:00Z')/86400000);
});
test('validation rejects impossible dates, unsafe links and invalid schedules',()=>{
 assert.equal(validate(event).before_days,3);
 for(const patch of [{event_date:'2026-02-30'},{before_days:-1},{after_days:31},{link_url:'//example.com'},{link_url:'javascript:alert(1)'},{link_url:'/\\example.com'},{link_label:''},{date_mode:'jalali_annual',jalali_month:8,jalali_day:31},{message:''},{is_active:'true'}])assert.throws(()=>validate({...event,...patch}),{code:'VALIDATION_ERROR'});
});
test('calendar routes restrict management, persist edits and expose only scheduled active messages',async()=>{
 let rows=[];const dbPath=require.resolve('../src/db');
 require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:async(sql,values)=>{
  if(sql.startsWith('INSERT')){const keys=sql.match(/\(([^)]+)\)/)[1].split(',');const row={id:'00000000-0000-4000-8000-000000000001',updated_at:new Date().toISOString()};keys.forEach((k,i)=>row[k]=values[i]);rows.push(row);return {rows:[row]};}
  if(sql.startsWith('UPDATE')){const row=rows.find(r=>r.id===values.at(-1));if(!row)return {rows:[]};for(const m of sql.matchAll(/(\w+)=\$(\d+)/g))row[m[1]]=values[Number(m[2])-1];return {rows:[row]};}
  if(sql.startsWith('DELETE')){const removed=rows.find(r=>r.id===values[0]);rows=rows.filter(r=>r.id!==values[0]);return {rows:removed?[{id:removed.id}]:[]};}
  return {rows:rows.filter(r=>!sql.includes('WHERE is_active=TRUE')||r.is_active)};
 }}};
 const authPath=require.resolve('../src/middleware/auth');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{authenticate:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.user={role:req.headers.authorization==='Bearer admin'?'admin':'user'};next();}}};
 const express=require('express'),app=express();app.use(express.json());app.use('/calendar',require('../src/routes/occasion-calendar'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/calendar`;
 const headers={Authorization:'Bearer admin','Content-Type':'application/json'};
 const payload={...event,event_date:new Date(todayOrdinal()*86400000).toISOString().slice(0,10)};
 try{
  assert.equal((await fetch(base+'/admin/all')).status,401);
  assert.equal((await fetch(base,{method:'POST',headers:{...headers,Authorization:'Bearer user'},body:JSON.stringify(payload)})).status,403);
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({...payload,link_url:'//unsafe.test'})})).status,400);
  const created=await fetch(base,{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(created.status,201);const saved=(await created.json()).event;
  let publicList=(await (await fetch(base)).json()).events;assert.equal(publicList.length,1);assert.equal(publicList[0].message,payload.message);assert.equal(publicList[0].date_mode,undefined);
  const edited=await fetch(base+'/'+saved.id,{method:'PUT',headers,body:JSON.stringify({...payload,message:'ویرایش ذخیره شد',is_active:false})});assert.equal(edited.status,200);
  const adminList=(await (await fetch(base+'/admin/all',{headers})).json()).events;assert.equal(adminList[0].message,'ویرایش ذخیره شد');assert.equal(adminList[0].status,'inactive');
  assert.equal((await (await fetch(base)).json()).events.length,0);
  rows=[{...saved,is_active:true,event_date:'2099-01-01'}];assert.equal((await (await fetch(base)).json()).events.length,0);
  assert.equal((await fetch(base+'/'+saved.id,{method:'DELETE'})).status,401);
  assert.equal((await fetch(base+'/'+saved.id,{method:'DELETE',headers:{Authorization:'Bearer user'}})).status,403);
  assert.equal(rows.length,1);
  assert.equal((await fetch(base+'/invalid',{method:'DELETE',headers})).status,400);
  rows[0].event_date=payload.event_date;
  assert.equal((await (await fetch(base)).json()).events.length,1);
  const deleted=await fetch(base+'/'+saved.id,{method:'DELETE',headers});assert.equal(deleted.status,200);assert.deepEqual(await deleted.json(),{deleted:true,id:saved.id});
  assert.equal((await (await fetch(base+'/admin/all',{headers})).json()).events.length,0);
  assert.equal((await (await fetch(base)).json()).events.length,0);
  assert.equal((await fetch(base+'/'+saved.id,{method:'DELETE',headers})).status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
