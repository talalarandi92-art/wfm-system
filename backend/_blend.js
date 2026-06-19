const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
  const ws=wb.getWorksheet('April SC');const fmt=v=>v instanceof Date?v.toISOString().slice(11,19):(v==null||v===''?'∅':(typeof v==='number'?(v*100).toFixed(0)+'%':v));
  ws.eachRow((r,n)=>{if(n===1)return;if(String(r.getCell(2).value)==='13758'){console.log('Abdul Rahman Kanj W'+r.getCell(8).value+': AHT='+(r.getCell(15).value instanceof Date?r.getCell(15).value.toISOString().slice(11,19):'∅')+' FRT='+(r.getCell(27).value instanceof Date?r.getCell(27).value.toISOString().slice(11,19):'∅')+' FCR='+fmt(r.getCell(17).value));}});
})().catch(e=>console.log('ERR',e.message));
