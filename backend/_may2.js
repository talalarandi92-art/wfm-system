const ExcelJS=require('exceljs');const XLSX=require('xlsx');
const SC='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx';
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
(async()=>{
const wbx=XLSX.readFile(SC);
// W1 header row
const w1=XLSX.utils.sheet_to_json(wbx.Sheets['W1'],{header:1,defval:''});
console.log('W1 row0:',JSON.stringify(w1[0]));
console.log('W1 row1:',JSON.stringify(w1[1]).slice(0,300));
// SC sheet: week labels per first agent + VLOOKUP
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(SC);
const ws=wb.getWorksheet('May SC 26');
let cnt=0;ws.eachRow((r,n)=>{if(n>=13&&n<=22){const b=r.getCell(2).value,i=r.getCell(9).value,g=r.getCell(7);console.log('row'+n,'agent='+JSON.stringify(b),'wk='+JSON.stringify(i),'Hfx='+String(g.formula||g.value||'').slice(0,60));}});
// voice date span (May present?)
for(const vf of ['Inbound.xlsx','Outbound.xlsx']){const rows=XLSX.utils.sheet_to_json(wbx2(D+vf),{header:1,defval:''});}
})().catch(e=>console.log('ERR',e.message));
function wbx2(f){return XLSX.readFile(f).Sheets[XLSX.readFile(f).SheetNames[0]];}
