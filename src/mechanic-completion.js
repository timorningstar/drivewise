export function mechanicCompletionIssues({name,hours,noPartsUsed,noPartsExplanation,work,files=[]}){
 const issues=[];
 if(!name.trim())issues.push('Enter the mechanic name.');
 if(!/^\d{1,4}(\.\d{1,2})?$/.test(String(hours).trim()))issues.push('Enter hours worked (0 is allowed if applicable).');
 if(files.length)issues.push('Upload or remove all selected files.');
 const invoices=work?.invoiceCount??(work?.files||[]).filter(f=>(f.kind==='invoice'||!f.kind)&&f.vendor?.trim()&&f.invoiceNumber?.trim()).length;
 if(noPartsUsed){if(!noPartsExplanation.trim())issues.push('Explain the work completed without parts.');}
 else if(!invoices)issues.push('Upload a vendor invoice, or select No parts were used and explain the work.');
 return issues;
}
