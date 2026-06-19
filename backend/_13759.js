const XLSX=require('xlsx');
const SC='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx';
const wbx=XLSX.readFile(SC);
const sn=wbx.SheetNames.find(n=>/SC 26/i.test(n));
const m=XLSX.utils.sheet_to_json(wbx.Sheets[sn],{header:1,defval:''});
const hr=m.findIndex(r=>r.some(c=>/^agent$/i.test(String(c)))&&r.some(c=>/^weeks$/i.test(String(c))));
console.log('SC sheet:',sn,'headerRow:',hr);
// find 13759 rows
for(let i=hr+1;i<m.length;i++){const r=m[i];if(String(r[2]).trim()==='13759'||/altamer/i.test(String(r[1]))){console.log('row'+i+': [1]='+JSON.stringify(r[1])+' [2]='+JSON.stringify(r[2])+' [4]='+JSON.stringify(r[4])+' [5]='+JSON.stringify(r[5]));}}
// is he in W1?
const w1=XLSX.utils.sheet_to_json(wbx.Sheets['W1'],{header:1,defval:''});
console.log('in W1?', w1.some(r=>String(r[1]).trim()==='13759'||/altamer/i.test(String(r[0]))));
