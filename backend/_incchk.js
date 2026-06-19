const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/4.April 26 SC - FILLED.xlsx');
const inc=wb.getWorksheet('Incentive');
console.log('Incentive populated:');
inc.eachRow((r,n)=>{if(n>16)return;const v=[1,2,3,4,5,6].map(c=>r.getCell(c).value).map(x=>x==null?'':typeof x==='object'?'=SUM':x);if(v.some(x=>x!==''))console.log('R'+n+': '+v.join(' | '));});
})().catch(e=>console.log('ERR',e.message));
