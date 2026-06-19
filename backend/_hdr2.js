const XLSX=require('xlsx');
const m=XLSX.utils.sheet_to_json(XLSX.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx').Sheets['April SC 26'],{header:1,defval:''});
console.log('header row12 idx0-6:',JSON.stringify(m[12].slice(0,7)));
console.log('data row13 idx0-6:',JSON.stringify(m[13].slice(0,7)));
const H=m[12].map(x=>String(x).trim().toLowerCase());
console.log('indexOf agent='+H.indexOf('agent')+' id='+H.indexOf('id')+' function='+H.indexOf('function'));
