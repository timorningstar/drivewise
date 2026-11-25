const repairRoles=['full','admin','schedule']
export const canReopenRepair=role=>[...repairRoles,'accounting'].includes(role)
export const canEditRepair=(role,repair)=>repairRoles.includes(role)||(role==='accounting'&&Boolean(repair?.id)&&repair.recordType!=='shopSupply'&&repair.correctionOpen===true)
