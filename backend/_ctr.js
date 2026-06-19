const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/May 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('May SC');let v=null,s=null;
ws.eachRow((r,n)=>{if(n===1||v)return;if(r.getCell(4).value==='Inbound'&&/final/i.test(String(r.getCell(8).value))){v=r.getCell(21).value;s=r.getCell(22).value;}});
console.log('Inbound Final CTR='+(v*100)+'% → score='+s+'  | FCR check:');
ws.eachRow((r,n)=>{if(n===1)return;if(r.getCell(4).value==='Inbound'&&/final/i.test(String(r.getCell(8).value))){console.log('  FCR='+(r.getCell(17).value*100)+'% → score='+r.getCell(18).value);return false;}});
})().catch(e=>console.log(e.message));
