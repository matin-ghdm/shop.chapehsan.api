const DAY = 86400000;
const persian = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric'});
const tehran = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'});
function todayOrdinal(now = new Date()) {
  const parts = Object.fromEntries(tehran.formatToParts(now).map(p=>[p.type,p.value]));
  return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day))/DAY;
}
function jalaliParts(day) {
  const p=Object.fromEntries(persian.formatToParts(new Date(day*DAY)).map(p=>[p.type,p.value]));
  return [Number(p.year),Number(p.month),Number(p.day)];
}
function jalaliOrdinal(year,month,day) {
  let lo=Date.UTC(year+621,0,1)/DAY, hi=Date.UTC(year+622,11,31)/DAY;
  const target=year*10000+month*100+day;
  while(lo<=hi){const mid=Math.floor((lo+hi)/2);const [y,m,d]=jalaliParts(mid);const key=y*10000+m*100+d;if(key===target)return mid;if(key<target)lo=mid+1;else hi=mid-1;}
  return null;
}
function schedule(event, now=new Date()) {
  const today=todayOrdinal(now), year=jalaliParts(today)[0];
  const candidates=event.date_mode==='jalali_annual' ? Array.from({length:10},(_,i)=>year-1+i).map(y=>jalaliOrdinal(y,event.jalali_month,event.jalali_day)).filter(d=>d!==null) : [Date.parse(event.event_date+'T00:00:00Z')/DAY];
  const occurrence=candidates.find(d=>d+event.after_days>=today) ?? candidates.at(-1);
  if(!Number.isFinite(occurrence))return null;
  const start=occurrence-event.before_days,end=occurrence+event.after_days;
  return {occurrence_date:new Date(occurrence*DAY).toISOString().slice(0,10),start_date:new Date(start*DAY).toISOString().slice(0,10),end_date:new Date(end*DAY).toISOString().slice(0,10),status:!event.is_active?'inactive':today<start?'upcoming':today>end?'past':'showing'};
}
function invalid(message){return Object.assign(new Error(message),{status:400,code:'VALIDATION_ERROR'});}
function validate(input){
  const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw invalid('نام و متن مناسبت را کامل و کوتاه وارد کنید');return value.trim();};
  const integer=(value,min,max)=>{if(!Number.isInteger(value)||value<min||value>max)throw invalid('عدد واردشده در محدودهٔ مجاز نیست');return value;};
  const title=text(input.title,150,true), message=text(input.message,600,true);
  if(!['congratulation','condolence','notice'].includes(input.kind))throw invalid('نوع پیام معتبر نیست');
  if(!['once','jalali_annual'].includes(input.date_mode))throw invalid('نوع تاریخ معتبر نیست');
  let event_date=null,jalali_month=null,jalali_day=null;
  if(input.date_mode==='once'){
    if(typeof input.event_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.event_date)||!Number.isFinite(Date.parse(input.event_date+'T00:00:00Z'))||new Date(input.event_date+'T00:00:00Z').toISOString().slice(0,10)!==input.event_date)throw invalid('تاریخ مناسبت معتبر نیست');
    event_date=input.event_date;
  }else{
    jalali_month=integer(input.jalali_month,1,12);jalali_day=integer(input.jalali_day,1,jalali_month<=6?31:30);
  }
  const link_url=text(input.link_url||'',1000),link_label=text(input.link_label||'',100);
  if(link_url&&(!link_url.startsWith('/')||link_url.startsWith('//')||/[\\\s\u0000-\u001f]/.test(link_url)))throw invalid('لینک باید مسیر داخلی سایت باشد؛ مثل /melli-mazhabi');
  if(link_url&&!link_label)throw invalid('عنوان لینک را وارد کنید');
  if(typeof input.is_active!=='boolean')throw invalid('وضعیت فعال بودن معتبر نیست');
  return {title,message,kind:input.kind,date_mode:input.date_mode,event_date,jalali_month,jalali_day,before_days:integer(input.before_days,0,30),after_days:integer(input.after_days,0,30),priority:integer(input.priority,0,100),is_active:input.is_active,link_url,link_label};
}
module.exports={todayOrdinal,jalaliOrdinal,schedule,validate};
