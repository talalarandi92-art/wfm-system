const ExcelJS=require('exceljs');const XLSX=require('xlsx');
(async()=>{
const f='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx';
const wbx=XLSX.readFile(f);console.log('SHEETS:',wbx.SheetNames.join(' | '));
// roster from W1
const w1=XLSX.utils.sheet_to_json(wbx.Sheets['W1'],{header:1,defval:''}).slice(1).filter(r=>r[0]);
console.log('May roster (W1):',w1.length);const fn={};w1.forEach(r=>fn[r[4]]=(fn[r[4]]||0)+1);console.log('functions:',JSON.stringify(fn));
// SC sheet: weeks per agent + VLOOKUP target sheet
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(f);
const sn=wb.worksheets.map(w=>w.name).find(n=>/SC/i.test(n));const ws=wb.getWorksheet(sn);
const wkSeen=new Set();let firstAgent=null;const vlk={};
ws.eachRow((r,n)=>{if(n<13)return;const ag=r.getCell(2).value;const wkv=r.getCell(9).value;if(ag&&wkv!==''&&wkv!=null){if(!firstAgent)firstAgent=ag;if(ag===firstAgent){wkSeen.add(String(wkv));const c7=r.getCell(7);const m=String(c7.formula||'').match(/'(W\d|[^']*Final[^']*)'/);if(m)vlk[String(wkv)]=m[1];}}});
console.log('SC sheet:',sn,'| weeks for first agent:',[...wkSeen].join(','));
console.log('VLOOKUP sheet per week:',JSON.stringify(vlk));
// productivity week blocks
const pr=XLSX.utils.sheet_to_json(wbx.Sheets['Productivity'],{header:1,defval:''})[0];
const marks=[];pr.forEach((x,i)=>{if(/^W[1-5]$/.test(String(x).trim()))marks.push(String(x).trim()+'@'+i);});
console.log('Productivity blocks:',marks.join(' '));
})().catch(e=>console.log('ERR',e.message));
