export function workflowProgress(repair){
 const denied=repair.eligibility?.decision==='not_eligible',complete=Boolean(repair.mechanic?.completedAt||repair.workflowStatus==='complete');
 const done=[Boolean(repair.eligibility),Boolean(repair.diagnostic),Boolean(repair.diagnosticNotes||complete),Boolean(repair.assignedMechanic||repair.workflowStatus==='live'||complete)];
 const next=denied?0:!done[0]?1:!done[1]?2:!done[2]?3:!done[3]?4:0;
 return {next,complete,denied,state:step=>done[step-1]?'done':next===step?'next':'upcoming'};
}
export const stepBadge=state=>state==='done'?'Completed · Edit':state==='next'?'Next step':'Upcoming'
