const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April FILLED v2.xlsx');
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
let bar=0,quiz=0,samples=[];
ws.eachRow((r,n)=>{if(n<14)return;const t=String(r.getCell(35).value||'');if(/bar score/.test(t))bar++;if(/quiz/.test(t)){quiz++;if(samples.length<3)samples.push(r.getCell(2).value+' W'+r.getCell(9).value);}});
console.log('main sheet "WFM Note" (col35) → bar notes:',bar,'| quiz notes:',quiz);
console.log('header col35:',JSON.stringify(ws.getCell(13,35).value),'| samples:',samples.join(' | '));
console.log('reread OK (file valid)');
})().catch(e=>console.log('ERR',e.message));
