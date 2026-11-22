const endpoint='https://dtmapp.web.app/api/dtm-access/drivewise/me';
const levels={"Executive Director":["full"],"Repairs only":["schedule"],"Accounting":["accounting"],"Repairs and accounting":["schedule","accounting"]};
async function hubSession(token,allowedRoles,fetcher=fetch){
 const response=await fetcher(endpoint,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
 if(!response.ok){const error=new Error('DriveWise Hub access is unavailable or has changed. Open DTM Hub again.');error.statusCode=response.status===401?401:403;throw error;}
 const grant=await response.json(),roles=levels[grant.role];
 if(!roles||!roles.some(role=>allowedRoles.includes(role))){const error=new Error('Your DriveWise access does not allow this action.');error.statusCode=403;throw error;}
 return {hub:true,role:roles.length>1?'admin':roles[0],roles,username:grant.name||grant.email,uid:grant.uid,adminId:grant.uid};
}
module.exports={hubSession};
