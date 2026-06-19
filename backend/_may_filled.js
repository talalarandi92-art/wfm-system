const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/5.May 26 SC - FILLED.xlsx');
console.log('reread OK; sheets:',wb.worksheets.length);
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
let bar=0,quiz=0,leave=0;ws.eachRow((r,n)=>{if(n<14)return;const t=String(r.getCell(35).value||'');if(/bar score/.test(t))bar++;if(/quiz/.test(t))quiz++;if(/on leave/.test(t))leave++;});
console.log('May WFM Note → bar:'+bar+' quiz:'+quiz+' on-leave:'+leave);
})().catch(e=>console.log('ERR',e.message));
