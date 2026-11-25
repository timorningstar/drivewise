function assertAccountingCorrection(existing,incoming){
 if(!existing?.id||existing.recordType==='shopSupply'||existing.correctionOpen!==true||incoming?.recordType==='shopSupply'){
  throw Object.assign(Error('Reopen an existing vehicle work order for corrections before editing or adding invoices.'),{statusCode:403});
 }
}
module.exports={assertAccountingCorrection};
