const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();const f='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April FILLED v3.xlsx';
await wb.xlsx.readFile(f);
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
let bar=0,quiz=0,leave=0,leaveSamp=[];ws.eachRow((r,n)=>{if(n<14)return;const t=String(r.getCell(35).value||'');if(/bar score/.test(t))bar++;if(/didn't solve/.test(t))quiz++;if(/on leave/.test(t)){leave++;if(leaveSamp.length<3)leaveSamp.push(r.getCell(2).value+' W'+r.getCell(9).value);}});
console.log('main WFM Note → bar:',bar,'| quiz:',quiz,'| on-leave:',leave,leaveSamp);
let cm=0;for(const sn of['W1','W2','W3','W4']){const w=wb.getWorksheet(sn);w.eachRow((r,n)=>{if(n===1)return;if(r.getCell(16).value===1)cm++;});}
console.log('Common Mistakes=1 across W1-4 (quiz-miss):',cm);
console.log('file valid (reread OK)');
})().catch(e=>console.log('ERR',e.message));
