const ExcelJS=require('exceljs');
const F='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx';
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(F);
console.log('SHEETS:',wb.worksheets.map(w=>w.name).join(' | '));
const ws=wb.getWorksheet('April SC');
// header row
const hdr=[];ws.getRow(1).eachCell((c,n)=>hdr[n]=c.value);
console.log('\nHEADER:',hdr.filter(Boolean).join(' | '));
// first agent's 5 rows
let printed=0,firstId=null;
ws.eachRow((r,n)=>{if(n===1)return;const id=r.getCell(2).value;if(firstId===null)firstId=id;if(id===firstId&&printed<5){const vals=[];for(let c=1;c<=28;c++){let v=r.getCell(c).value;if(v instanceof Date)v=v.toISOString().slice(11,19);if(typeof v==='number')v=Math.round(v*1000)/1000;vals.push(v===null||v===undefined?'':v);}console.log('R'+n+':',vals.join(' | '));printed++;}});
})().catch(e=>console.log('ERR',e.message));
