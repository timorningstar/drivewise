function assertRepairEditable(repair){
 if(repair?.historicalComplete&&!repair.correctionOpen){throw Object.assign(new Error('This completed repair record is view-only. Reopen it for corrections first.'),{statusCode:409});}
}
module.exports={assertRepairEditable};
