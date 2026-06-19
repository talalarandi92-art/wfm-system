const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/5.May 26 SC - FILLED.xlsx');
console.log('reread OK; sheets:',wb.worksheets.length);
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
const ids=new Set();ws.eachRow((r,n)=>{if(n<14)return;const id=r.getCell(3).value;if(id&&!isNaN(id))ids.add(Number(id));});
console.log('main sheet distinct agents:',ids.size);
// a new joiner: Khaled Aliullah — show his Final row formula + W5 value
let found=null;ws.eachRow((r,n)=>{if(found)return;if(/khaled aliullah/i.test(String(r.getCell(2).value))&&/final/i.test(String(r.getCell(9).value)))found=r;});
if(found){const net=found.getCell(8).value;console.log('Khaled Aliullah Final: Net cell =',JSON.stringify(net).slice(0,80));}
else console.log('Khaled Aliullah Final row NOT found');
})().catch(e=>console.log('ERR',e.message));
