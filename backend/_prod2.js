const XLSX=require('xlsx');
const wb=XLSX.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx');
const r=XLSX.utils.sheet_to_json(wb.Sheets['Productivity'],{header:1,defval:''});
const h=r[0];
const marks=[]; h.forEach((x,i)=>{if(/^W[1-5]$/.test(String(x).trim()))marks.push({wk:String(x).trim(),col:i});});
console.log('week blocks:',marks.map(m=>m.wk+'@'+m.col).join(' '));
// all WD% and Productivity% positions
const wd=[],pr=[]; h.forEach((x,i)=>{const s=String(x).trim().toLowerCase();if(/^wd%$/.test(s))wd.push(i);if(/productivity/.test(s))pr.push(i);});
console.log('WD% cols:',wd.join(','));
console.log('Productivity% cols:',pr.join(','));
// for each block, which WD%/Prod col falls in it + ID col
marks.forEach((m,idx)=>{const end=idx+1<marks.length?marks[idx+1].col:h.length;const idc=[];for(let c=m.col;c<end;c++){if(/^id$/i.test(String(h[c]).trim()))idc.push(c);}const w=wd.filter(c=>c>=m.col&&c<end);const p=pr.filter(c=>c>=m.col&&c<end);console.log(m.wk+' ['+m.col+'-'+end+'): ID@'+idc.join(',')+' WD%@'+w.join(',')+' Prod%@'+p.join(','));});
