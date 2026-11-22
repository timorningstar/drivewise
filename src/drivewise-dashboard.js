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
