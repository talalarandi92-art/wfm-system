const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx');
const ws=wb.getWorksheet('Incentive');
if(!ws){console.log('NO Incentive sheet');return;}
console.log('Incentive dims: rows~'+ws.actualRowCount+' cols~'+ws.actualColumnCount);
// dump first 16 rows × 14 cols (non-empty)
for(let r=1;r<=16;r++){let cells=[];for(let c=1;c<=14;c++){const v=ws.getCell(r,c).value;if(v!==null&&v!=='')cells.push(String.fromCharCode(64+c)+r+'='+(typeof v==='object'?JSON.stringify(v).slice(0,20):v));}if(cells.length)console.log('R'+r+': '+cells.join(' | '));}
})().catch(e=>console.log('ERR',e.message));
