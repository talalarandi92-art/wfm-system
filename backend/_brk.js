const XLSX=require('xlsx');
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
// 1) sprinklr may break file
const sb=XLSX.readFile(D+'sprinklr may break.xlsx');
console.log('=== sprinklr may break.xlsx ===');
console.log('sheets:',sb.SheetNames.join(' | '));
for(const sn of sb.SheetNames.slice(0,3)){const r=XLSX.utils.sheet_to_json(sb.Sheets[sn],{header:1,defval:''});console.log(`[${sn}] rows=${r.length} row0=`+JSON.stringify(r[0]).slice(0,200));console.log('  row1='+JSON.stringify(r[1]).slice(0,200));}
// 2) May SC Productivity — check if break now per-week (W2-W5 blocks)
console.log('\n=== May Productivity blocks: WD + break cols populated? ===');
const pr=XLSX.utils.sheet_to_json(XLSX.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx').Sheets['Productivity'],{header:1,defval:''});
const h=pr[0];
[0,26,51,77,103].forEach(off=>{const lbl=h[off];const cols=[];for(let i=off;i<off+30&&i<h.length;i++){if(h[i]!=='')cols.push(i+':'+h[i]);}console.log(`block@${off}(${lbl}): `+cols.join(' ').slice(0,260));});
