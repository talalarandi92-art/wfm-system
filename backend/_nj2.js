const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/5.May 26 SC - FILLED.xlsx');
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
// Khaled Aliullah Final Net formula (should be standalone K..+.. refs to HIS row, not shared)
ws.eachRow((r,n)=>{if(n<14)return;if(/khaled aliullah/i.test(String(r.getCell(2).value))){const wk=r.getCell(9).value;const net=r.getCell(8).value;const vlk=r.getCell(7).value;
  console.log('Khaled W'+wk+': Net='+JSON.stringify(net).slice(0,70)+' | WD%formula='+JSON.stringify(vlk).slice(0,55));}});
})().catch(e=>console.log('ERR',e.message));
