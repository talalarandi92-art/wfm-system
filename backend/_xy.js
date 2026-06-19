const ExcelJS=require('exceljs');
const F='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx';
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(F);
const pr=wb.getWorksheet('Productivity');
const h=pr.getRow(1);
console.log('=== W1 block headers A..AB (1..28) ===');
for(let i=1;i<=28;i++){const hv=h.getCell(i).value;const c2=pr.getRow(2).getCell(i);const f=c2.value&&c2.value.formula;console.log(`col${i} ${pr.getColumn(i).letter}: HDR=${JSON.stringify(hv)}  row2=${f?('=F: '+f):JSON.stringify(c2.value)}`);}
})().catch(e=>console.log('ERR',e.message));
