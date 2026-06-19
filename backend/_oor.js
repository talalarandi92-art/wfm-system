const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('April SC');
ws.eachRow((r,n)=>{if(n===1)return;const prod=r.getCell(19).value;if(typeof prod==='number'&&(prod<0||prod>1.0001)){console.log(r.getCell(1).value,'('+r.getCell(4).value+') W'+r.getCell(8).value,'prod='+(prod*100).toFixed(1)+'%');}});
})().catch(e=>console.log(e.message));
