const ExcelJS=require('exceljs');
(async()=>{
for(const f of ['5.May 26 SC - FILLED.xlsx','4.April 26 SC - FILLED.xlsx']){
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/'+f);
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));const K=ws.getCell(14,11).value;
console.log(f.slice(0,12),'K14 Quality Score =',JSON.stringify(K),'(no "result" = will recompute to 30)');
}})().catch(e=>console.log('ERR',e.message));
