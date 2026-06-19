const XLSX=require('xlsx');
const SC='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx';
const pr=XLSX.utils.sheet_to_json(XLSX.readFile(SC).Sheets['Productivity'],{header:1,defval:''});
const h=pr[0];
// find all column indices whose header contains 'Productivity' or 'WD%' or 'W1'..'W5'
h.forEach((c,i)=>{const s=String(c).trim();if(/^W[1-5]$/.test(s)||/Productivity/i.test(s)||/^WD%?$/i.test(s)||/Working Days/i.test(s))console.log('col'+i+': '+s);});
console.log('--- sample row1 values at those cols ---');
console.log('total header cols:',h.length);
