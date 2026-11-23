export const requestDenied=repair=>repair.workflowStatus==='not_eligible'||repair.eligibility?.decision==='not_eligible'
export const hasCustomerHistory=repair=>Number.isSafeInteger(repair.customerAccount?.chargeCents)||Boolean(repair.customerAccount?.payments?.length||repair.customerAccount?.audit?.length)
export function customerAccountVisible(repair){
 return repair.recordType!=='shopSupply'&&(!repair.historicalComplete||repair.correctionOpen||repair.customerAccount)&&(!requestDenied(repair)||hasCustomerHistory(repair))
}
