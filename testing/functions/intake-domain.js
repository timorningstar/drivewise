const crypto=require('node:crypto');
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const slots=['15:30','15:50','16:10'];
function date(value){const parsed=new Date(value+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail('Enter a valid date.');return value;}
function appointment(input){const day=date(input.date);if(new Date(day+'T12:00:00Z').getUTCDay()!==1||!slots.includes(input.time))fail('Choose Monday at 3:30, 3:50 or 4:10 PM.');return {date:day,time:input.time,timeZone:'America/Indiana/Indianapolis'};}
function fields(input){const result={ownerName:clean(input.ownerName,150),email:clean(input.email,254).toLowerCase(),phone:clean(input.phone,50),make:clean(input.make,100),model:clean(input.model,100),year:clean(input.year,4),classAttendance:clean(input.classAttendance,2000),neededRepairs:clean(input.neededRepairs,6000),payer:clean(input.payer||input.ownerName,150)};
 if(!result.ownerName||!result.phone||!result.make||!result.model||!/^\d{4}$/.test(result.year)||!result.neededRepairs||!result.classAttendance||(result.email&&!/^\S+@[^\s@]+\.[^\s@]+$/.test(result.email)))fail('Enter customer name, phone, vehicle, DTM class attendance and repair need. If supplied, email must be valid.');return result;}
function nextMonday(value=new Date()){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);const result=new Date(day+'T12:00:00Z');result.setUTCDate(result.getUTCDate()+((8-result.getUTCDay())%7||7));return result.toISOString().slice(0,10);}
function operation(value){if(!/^[0-9a-f-]{36}$/.test(value||''))fail('Reload this form and try again.');return value;}
function hours(value){const text=String(value??'').trim();if(!/^\d{1,4}(\.\d{1,2})?$/.test(text))fail('Enter approximate mechanic hours, including 0 if applicable.');return Number(text);}
function audit(repair,action,actor,details){return {...repair,revision:(repair.revision||0)+1,workflowHistory:[...(repair.workflowHistory||[]),{at:new Date().toISOString(),by:actor,action,details}].slice(-300)};}
const newToken=()=>crypto.randomBytes(32).toString('hex');
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
module.exports={fail,clean,date,appointment,fields,nextMonday,operation,hours,audit,slots,newToken,hash};
