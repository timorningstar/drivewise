const crypto=require('node:crypto');
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const slots=['15:30','15:50','16:10'];
function date(value){const parsed=new Date(value+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail('Enter a valid date.');return value;}
function appointment(input,settings={diagnosticDay:1,diagnosticTimes:slots}){const day=date(input.date);if(new Date(day+'T12:00:00Z').getUTCDay()!==settings.diagnosticDay||!settings.diagnosticTimes.includes(input.time))fail('Choose the diagnostic day and one of the appointment times currently listed in Setup.');return {date:day,time:input.time,timeZone:'America/Indiana/Indianapolis'};}
function vehicleIdentifiers(input){const result={};if(Object.hasOwn(input,'vin')){const vin=clean(input.vin,31).toUpperCase();if(vin&&!/^[A-Z0-9-]{1,30}$/.test(vin))fail('Enter a valid VIN, up to 30 letters, numbers or hyphens.');result.vin=vin;}if(Object.hasOwn(input,'mileage')){const mileage=String(input.mileage??'').trim();if(mileage&&!/^\d{1,8}$/.test(mileage))fail('Enter mileage as a whole number, 0 or greater.');result.mileage=mileage?Number(mileage):null;}return result;}
function fields(input){const result={ownerName:clean(input.ownerName,150),email:clean(input.email,254).toLowerCase(),phone:clean(input.phone,50),make:clean(input.make,100),model:clean(input.model,100),year:clean(input.year,4),classAttendance:clean(input.classAttendance,2000),neededRepairs:clean(input.neededRepairs,6000),payer:clean(input.payer||input.ownerName,150),...vehicleIdentifiers(input)};
 if(!result.ownerName||!result.phone||!result.make||!result.model||!/^\d{4}$/.test(result.year)||!result.neededRepairs||!result.classAttendance||(result.email&&!/^\S+@[^\s@]+\.[^\s@]+$/.test(result.email)))fail('Enter customer name, phone, vehicle, DTM class attendance and repair need. If supplied, email must be valid.');return result;}
function nextDiagnosticDay(weekday=1,value=new Date()){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);const result=new Date(day+'T12:00:00Z');result.setUTCDate(result.getUTCDate()+((weekday-result.getUTCDay()+7)%7||7));return result.toISOString().slice(0,10);}
const nextMonday=value=>nextDiagnosticDay(1,value);
function operation(value){if(!/^[0-9a-f-]{36}$/.test(value||''))fail('Reload this form and try again.');return value;}
function hours(value){const text=String(value??'').trim();if(!/^\d{1,4}(\.\d{1,2})?$/.test(text))fail('Enter approximate mechanic hours, including 0 if applicable.');return Number(text);}
function audit(repair,action,actor,details){return {...repair,revision:(repair.revision||0)+1,workflowHistory:[...(repair.workflowHistory||[]),{at:new Date().toISOString(),by:actor,action,details}].slice(-300)};}
const newToken=()=>crypto.randomBytes(32).toString('hex');
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
module.exports={fail,clean,date,appointment,fields,vehicleIdentifiers,nextMonday,nextDiagnosticDay,operation,hours,audit,slots,newToken,hash};
