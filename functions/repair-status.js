function assertRepairEditable(repair){
 if(repair?.historicalComplete){throw Object.assign(new Error('This completed repair record is view-only.'),{statusCode:409});}
}
module.exports={assertRepairEditable};
