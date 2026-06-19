const XLSX=require('xlsx');
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
// May Productivity distinct IDs (any block) vs roster 66
const pr=XLSX.utils.sheet_to_json(XLSX.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx').Sheets['Productivity'],{header:1,defval:''});
const h=pr[0];const idCols=[];h.forEach((x,i)=>{if(String(x).trim().toLowerCase()==='id')idCols.push(i);});
const ids=new Set();idCols.forEach(c=>{for(let i=1;i<pr.length;i++){const v=pr[i][c];if(typeof v==='number')ids.add(v);}});
console.log('May Productivity distinct IDs:',ids.size);
// New Joiners quiz files
const fs=require('fs');const njf=fs.readdirSync(D).filter(f=>/new joiner/i.test(f));
console.log('New Joiner files:',njf);
njf.forEach(f=>{const q=XLSX.utils.sheet_to_json(XLSX.readFile(D+f).Sheets[XLSX.readFile(D+f).SheetNames[0]],{header:1,defval:''});const hh=q[0];const ni=hh.findIndex(c=>/name/i.test(c));console.log(' ['+f+'] rows='+(q.length-1)+' names:',q.slice(1,8).map(r=>r[ni]).filter(Boolean).join(', '));});
