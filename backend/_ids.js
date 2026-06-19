const XLSX=require('xlsx');
const w1=XLSX.utils.sheet_to_json(XLSX.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx').Sheets['W1'],{header:1,defval:''}).slice(1);
w1.forEach(r=>{const n=String(r[0]||'').toLowerCase();if(/shaim|haya|mohan|saoud/.test(n))console.log('roster:',r[0],'| ID',r[1],'| uid',r[2],'| func',r[4]);});
