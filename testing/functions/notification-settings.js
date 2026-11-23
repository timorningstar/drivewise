const {randomUUID}=require('node:crypto');
const fail=message=>{throw Object.assign(Error(message),{statusCode:400});};
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^\S+@[^\s@]+\.[^\s@]+$/.test(value);
const clean=value=>String(value||'').trim().toLowerCase();
const defaults={
 carRepairRequestEmails:['carapp@downtownmin.org','carrepair@downtownmin.org'],
 accountingEmail:'accounting@downtownmin.org',
 diagnosticEmail:'t1@downtownmin.org',
 contactEmail:'carrepair@downtownmin.org',
 mechanics:[{id:'tim-morningstar',name:'Tim Morningstar',email:'tim@tjmstar.com',active:true}]
};
function requestEmails(input){
 if(!Array.isArray(input)||input.length>3)fail('Car Repair Requests allows up to three email addresses.');
 const result=[...new Set(input.map(clean).filter(Boolean))];
 if(!result.length||result.some(email=>!validEmail(email)))fail('Enter one to three valid Car Repair Requests email addresses.');
 return result;
}
function readSettings(source={}){
 const legacy=[source.applicationEmail,source.repairEmail].filter(Boolean);
 return {
  carRepairRequestEmails:requestEmails(source.carRepairRequestEmails??(legacy.length?legacy:defaults.carRepairRequestEmails)),
  accountingEmail:source.accountingEmail||defaults.accountingEmail,
  diagnosticEmail:source.diagnosticEmail||defaults.diagnosticEmail,
  contactEmail:source.contactEmail||source.repairEmail||defaults.contactEmail,
  mechanics:source.mechanics||defaults.mechanics
 };
}
function validateSettings(input){
 // Accept an already-open older settings form during rollout without losing its recipients.
 const next={carRepairRequestEmails:requestEmails(input.carRepairRequestEmails??[input.applicationEmail,input.repairEmail].filter(Boolean))};
 for(const key of ['accountingEmail','diagnosticEmail','contactEmail']){
  const value=clean(input[key]||(key==='contactEmail'?input.repairEmail:''));
  if(!validEmail(value))fail('Enter a valid email address for each notification function.');next[key]=value;
 }
 if(!Array.isArray(input.mechanics)||input.mechanics.length>40)fail('Enter up to 40 mechanics.');
 next.mechanics=input.mechanics.map(m=>{
  const name=String(m.name||'').trim().slice(0,150),email=clean(m.email);
  if(!name||!validEmail(email))fail('Each mechanic needs a name and valid email.');
  return {id:/^[a-z0-9-]{1,60}$/.test(m.id||'')?m.id:randomUUID(),name,email,active:m.active!==false};
 });
 return next;
}
module.exports={defaults,readSettings,validateSettings,requestEmails};
