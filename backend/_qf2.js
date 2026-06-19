const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/5.May 26 SC - FILLED.xlsx');
const w1=wb.getWorksheet('W1');
// QA = col G(7). Sample first 3 agents
let s=0;w1.eachRow((r,n)=>{if(n===1||s>=3)return;const id=r.getCell(2).value;if(id&&!isNaN(id)){console.log('W1',r.getCell(1).value,'QA(G)='+JSON.stringify(r.getCell(7).value));s++;}});
// main sheet J (Quality value) + K (Quality Score) for first data row
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
const J=ws.getCell(14,10),K=ws.getCell(14,11);
console.log('main J14 (Quality):',JSON.stringify(J.value).slice(0,120));
console.log('main K14 (Quality Score):',JSON.stringify(K.value).slice(0,160));
})().catch(e=>console.log('ERR',e.message));
