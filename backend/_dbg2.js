const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx');
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
// first 7 data rows: col3 ID, col9 week
for(let n=14;n<=20;n++){const r=ws.getRow(n);console.log('row'+n,'ID(c3)='+JSON.stringify(r.getCell(3).value),'Week(c9)='+JSON.stringify(r.getCell(9).value));}
})().catch(e=>console.log(e.message));
