const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/4.April 26 SC - FILLED.xlsx');
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
const K=ws.getCell(14,11).value, H=ws.getCell(14,8).value;  // Quality Score, Net Points
console.log('K14 (Quality Score):',JSON.stringify(K));
console.log('H14 (Net Points):',JSON.stringify(H));
// CF empty check
const {execSync}=require('child_process');let cf=0;for(const n of[6,7,8,9,10]){const x=execSync(`unzip -p "C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/4.April 26 SC - FILLED.xlsx" "xl/worksheets/sheet${n}.xml"`,{maxBuffer:1e8}).toString();cf+=(x.match(/<conditionalFormatting[^>]*\/>/g)||[]).length;}
console.log('empty CF:',cf);
})().catch(e=>console.log('ERR',e.message));
