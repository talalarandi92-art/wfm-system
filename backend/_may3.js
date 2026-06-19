const XLSX=require('xlsx');
const SC='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx';
const wbx=XLSX.readFile(SC);
const qa=XLSX.utils.sheet_to_json(wbx.Sheets['QA'],{header:1,defval:''});
console.log('QA rows:',qa.length,'| row0:',JSON.stringify(qa[0]));
console.log('QA row1-3:',JSON.stringify(qa.slice(1,4)));
const nonEmptyQA=qa.slice(1).filter(r=>r.some((c,i)=>i>0&&c!=='')).length;
console.log('QA data rows (any value):',nonEmptyQA);
// Productivity: check W4 block date range hint (header labels at @77, W5 @103)
const pr=XLSX.utils.sheet_to_json(wbx.Sheets['Productivity'],{header:1,defval:''});
console.log('Prod row0 around W4@77:',JSON.stringify(pr[0].slice(77,90)));
console.log('Prod row0 around W5@103:',JSON.stringify(pr[0].slice(103,116)));
