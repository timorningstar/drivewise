const d=require('./intake-domain');
const text=(value,label,max,required=false)=>{
 const result=String(value??'').trim();
 if(result.length>max||required&&!result)d.fail(`Enter ${label}${required?' (required)':''}, up to ${max} characters.`);
 return result;
};
const answer=(value,label)=>{if(!['yes','no'].includes(value))d.fail(`Choose Yes or No for ${label}.`);return value==='yes'?'Yes':'No';};
// Additional answers exist only in request memory and the intended email.
// Never spread this object into a work order, notification record or log.
function applicationInput(input){
 if(input.formVersion!=='2')d.fail('Please refresh the page to use the current application form.');
 const first=text(input.firstName,'first name',75,true),last=text(input.lastName,'last name',75,true);
 if((first+' '+last).length>150)d.fail('Enter a name up to 150 characters.');
 const answers={
  participant:answer(input.participant,'DTM program participation'),
  referringAgency:text(input.referringAgency,'referring agency',500,input.participant==='no'),
  referralPhone:text(input.referralPhone,'referral phone number',100),
  referralEmail:text(input.referralEmail,'referral email',254),
  bestContactTime:text(input.bestContactTime,'best time to contact you',300),
  driversLicense:answer(input.driversLicense,'valid driver’s license'),
  registered:answer(input.registered,'vehicle registration'),
  insured:answer(input.insured,'vehicle insurance'),
  vehicleLocation:text(input.vehicleLocation,'current vehicle location',500,true),
  mechanicDiagnosis:answer(input.mechanicDiagnosis,'previous mechanic diagnosis'),
  recentRepairs:text(input.recentRepairs,'recent major repairs or accidents',1500),
  primaryTransportation:answer(input.primaryTransportation,'primary transportation'),
  dailyLife:text(input.dailyLife,'how the vehicle helps your daily life',1500),
 };
 if(answers.referralEmail&&!/^\S+@[^\s@]+\.[^\s@]+$/.test(answers.referralEmail))d.fail('Enter a valid referral email address.');
 const core=d.fields({...input,ownerName:first+' '+last,payer:first+' '+last,classAttendance:input.participant==='yes'?input.classAttendance:'Partner agency referral'});
 if(!core.vin||core.mileage===null||core.mileage===undefined)d.fail('Enter the vehicle VIN and mileage.');
 return {core,answers};
}
function applicationEmailLines(answers){return [
 ['DTM program participant',answers.participant],['Referring agency',answers.referringAgency],
 ['Referral phone number',answers.referralPhone],['Referral email',answers.referralEmail],['Best time to contact',answers.bestContactTime],
 ['Valid driver’s license',answers.driversLicense],['Vehicle currently registered',answers.registered],['Vehicle currently insured',answers.insured],
 ['Current vehicle location',answers.vehicleLocation],['Diagnosed by a mechanic',answers.mechanicDiagnosis],
 ['Recent major repairs or accidents',answers.recentRepairs],['Primary form of transportation',answers.primaryTransportation],['Importance in daily life',answers.dailyLife],
].map(([label,value])=>`${label}: ${value||'Not provided'}`).join('\n\n');}
module.exports={applicationInput,applicationEmailLines};
