const express=require('express');const {query}=require('../db');const {authenticate}=require('../middleware/auth');
const {schedule,validate}=require('../services/occasion-calendar');
const {requirePermission}=require('../lib/panel-permissions');
const router=express.Router();
const admin=requirePermission('calendar.manage');
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({message:e.status?e.message:'دریافت یا ذخیرهٔ مناسبت ناموفق بود',code:e.code});}};
router.get('/',wrap(async(req,res)=>{
 const rows=(await query('SELECT * FROM occasion_calendar WHERE is_active=TRUE ORDER BY priority DESC, title')).rows;
 const events=rows.map(e=>({...e,...schedule(e)})).filter(e=>e.status==='showing').map(({id,title,message,kind,link_url,link_label,occurrence_date,start_date,end_date,updated_at})=>({id,title,message,kind,link_url,link_label,occurrence_date,start_date,end_date,updated_at}));
 res.set('Cache-Control','no-store').json({events});
}));
router.get('/admin/all',authenticate,admin,wrap(async(req,res)=>{
 const rows=(await query('SELECT * FROM occasion_calendar ORDER BY priority DESC, title')).rows;
 res.set('Cache-Control','no-store').json({events:rows.map(e=>({...e,...schedule(e)}))});
}));
router.post('/',authenticate,admin,wrap(async(req,res)=>{
 const data=validate(req.body),keys=Object.keys(data);
 const result=await query(`INSERT INTO occasion_calendar (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(data));
 res.status(201).json({event:result.rows[0]});
}));
router.put('/:id',authenticate,admin,wrap(async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return res.status(400).json({message:'شناسه معتبر نیست'});
 const data=validate(req.body),keys=Object.keys(data);
 const result=await query(`UPDATE occasion_calendar SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=NOW() WHERE id=$${keys.length+1} RETURNING *`,[...Object.values(data),req.params.id]);
 if(!result.rows[0])return res.status(404).json({message:'مناسبت پیدا نشد'});
 res.json({event:result.rows[0]});
}));
router.delete('/:id',authenticate,admin,wrap(async(req,res)=>{
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id))return res.status(400).json({message:'شناسه معتبر نیست'});
 const result=await query('DELETE FROM occasion_calendar WHERE id=$1 RETURNING id',[req.params.id]);
 if(!result.rows[0])return res.status(404).json({message:'مناسبت پیدا نشد'});
 res.json({deleted:true,id:result.rows[0].id});
}));
module.exports=router;
