const XLSX=require('xlsx');
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
const r=XLSX.utils.sheet_to_json(XLSX.readFile(D+'sprinklr april break.xlsx').Sheets['WhatsApp Login Logout'],{header:1,defval:''});
console.log('FULL HEADER (row2):');r[2].forEach((c,i)=>console.log(`  col${i}: ${c}`));
console.log('\nsample data row3:');r[3].forEach((c,i)=>console.log(`  col${i}: ${JSON.stringify(c)}`));
