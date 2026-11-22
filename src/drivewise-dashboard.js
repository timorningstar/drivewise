export function vehicleRepairComplete(repair) {
  if(repair.correctionOpen)return false
  return Boolean(repair.historicalComplete||repair.mechanic?.completedAt||repair.customerAccount?.closedAt)
}
export function dashboardTotals(repairs) {
  const vehicles=repairs.filter(r=>r.recordType!=='shopSupply')
  return {
    open:vehicles.filter(r=>!vehicleRepairComplete(r)).length,
    completed:vehicles.filter(vehicleRepairComplete).length,
    balanceCents:vehicles.reduce((sum,r)=>sum+Math.max(0,r.customerAccount?.balanceCents||0),0),
    unchecked:repairs.flatMap(r=>r.invoices||[]).filter(i=>!i.statementChecked&&!i.statementComplete).length,
  }
}
