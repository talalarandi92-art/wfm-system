const XLSX=require('xlsx');
const SC='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx';
const wbx=XLSX.readFile(SC);const sn=wbx.SheetNames.find(n=>/SC 26/i.test(n));
const m=XLSX.utils.sheet_to_json(wbx.Sheets[sn],{header:1,defval:''});
let hits=[];for(let i=0;i<m.length;i++){const r=m[i];for(let c=0;c<8;c++){if(String(r[c]).trim()==='13759'){hits.push('row'+i+' [col'+c+']=13759 fullrow0-6:'+JSON.stringify(r.slice(0,7)));}}}
console.log('13759 occurrences in original main sheet:',hits.length);hits.slice(0,6).forEach(h=>console.log('  '+h));
console.log('total rows:',m.length,'| header detect row:',m.findIndex(r=>r.some(c=>/^agent$/i.test(String(c)))&&r.some(c=>/^weeks$/i.test(String(c)))));
