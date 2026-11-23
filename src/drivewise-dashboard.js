export function vehicleRepairComplete(repair) {
  if(repair.correctionOpen)return false
  return Boolean(repair.historicalComplete||repair.mechanic?.completedAt||repair.customerAccount?.closedAt||repair.workflowStatus==='complete')
}
export function pendingRepairRequest(repair) {
  return !vehicleRepairComplete(repair)&&['pending','diagnostic_scheduled','awaiting_repair'].includes(repair.workflowStatus)
}
export function vehicleRepairOpen(repair) {
  return !vehicleRepairComplete(repair)&&Boolean(!repair.workflowStatus||repair.workflowStatus==='live'||repair.correctionOpen)
}
export function dashboardTotals(repairs) {
  const vehicles=repairs.filter(r=>r.recordType!=='shopSupply')
  return {
    pending:vehicles.filter(pendingRepairRequest).length,
    open:vehicles.filter(vehicleRepairOpen).length,
    completed:vehicles.filter(vehicleRepairComplete).length,
    balanceCents:vehicles.reduce((sum,r)=>sum+Math.max(0,r.customerAccount?.balanceCents||0),0),
    unchecked:repairs.flatMap(r=>r.invoices||[]).filter(i=>!i.statementChecked&&!i.statementComplete).length,
  }
}

export function vehicleRepairRecord(repair){
 return repair.recordType!=='shopSupply'&&repair.workflowStatus!=='not_eligible'&&repair.eligibility?.decision!=='not_eligible'&&(vehicleRepairOpen(repair)||vehicleRepairComplete(repair))
}

export function repairCompletionDate(repair){
 const completed=repair.mechanic?.completedAt;
 if(completed&&Number.isFinite(Date.parse(completed)))return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(completed));
 return /^\d{4}-\d{2}-\d{2}$/.test(repair.repairDate||'')?repair.repairDate:'';
}
export function completedRepairInRange(repair,{from='',through=''}={}){
 if(from&&through&&from>through)return false;
 if(!from&&!through)return true;
 const date=repairCompletionDate(repair);
 return Boolean(date&&(!from||date>=from)&&(!through||date<=through));
}
