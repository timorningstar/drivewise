const {OAuth2Client}=require('google-auth-library');
const audience='https://drivewise.web.app/api/drivewise-service-metrics';
const trustedCaller='dtm-work-orders@dtm-housing.iam.gserviceaccount.com';
const client=new OAuth2Client();
const fail=message=>{throw Object.assign(Error(message),{statusCode:400});};
function dateRange(from,through) {
 for(const value of [from,through])if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('Enter a valid date range.');
 if(from>through)fail('The end date must be on or after the start date.');
 return {from,through};
}
async function verifyMetricsCaller(token,verifier=client) {
 if(!token||token.length>10000)return false;
 try{const ticket=await verifier.verifyIdToken({idToken:token,audience});const claims=ticket.getPayload();return claims.email===trustedCaller&&claims.email_verified===true;}catch{return false;}
}
const key=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
function drivewiseMetrics(repairs,workByRepair,from,through) {
 const range=dateRange(from,through),vehicles=new Set(),persons=new Set();let completedRepairs=0,hours=0,hoursRecorded=0,missingOwner=0,vehicleFallback=0;
 for(const repair of repairs) {
  if(repair.recordType==='shopSupply'||!repair.repairDate||repair.repairDate<from||repair.repairDate>through)continue;
  const work=workByRepair.get(repair.id)||{};
  if(!repair.historicalComplete&&!work.completedAt)continue;
  completedRepairs++;
  const vehicle=repair.vehicleTrackingId||[key(repair.ownerName),key(repair.year),key(repair.make),key(repair.model)].join('|');
  if(!repair.vehicleTrackingId)vehicleFallback++;
  vehicles.add(vehicle||repair.id);
  if(key(repair.ownerName))persons.add(key(repair.ownerName));else missingOwner++;
  if(typeof work.approxHours==='number'&&Number.isFinite(work.approxHours)&&work.approxHours>=0){hours+=work.approxHours;hoursRecorded++;}
 }
 return {range,dateBasis:'repairDate',completedRepairs,vehicles:vehicles.size,persons:persons.size,mechanicHours:Math.round(hours*100)/100,hoursRecorded,hoursMissing:completedRepairs-hoursRecorded,missingOwner,vehicleFallback,checkedAt:new Date().toISOString()};
}
module.exports={drivewiseMetrics,dateRange,verifyMetricsCaller,audience};
