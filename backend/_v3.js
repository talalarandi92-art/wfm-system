const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April FILLED v2.xlsx');
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
let bar=0,quiz=0,leave=0;ws.eachRow((r,n)=>{if(n<14)return;const t=String(r.getCell(35).value||'');if(/bar score/.test(t))bar++;if(/quiz/.test(t))quiz++;if(/on leave/.test(t))leave++;});
console.log('main WFM Note → bar:',bar,'quiz:',quiz,'on-leave:',leave);
// Common Mistakes in W4 sheet (quiz-miss=1)
const w4=wb.getWorksheet('W4');let cm=0;w4.eachRow((r,n)=>{if(n===1)return;if(r.getCell(16).value===1)cm++;});
console.log('W4 Common Mistakes=1 (quiz-miss):',cm);
})().catch(e=>console.log('ERR',e.message));
