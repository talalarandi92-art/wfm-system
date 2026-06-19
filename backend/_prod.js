const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
  const ws=wb.getWorksheet('April SC');
  ws.eachRow((r,n)=>{if(n===1)return;if(String(r.getCell(2).value)==='13758'){const p=r.getCell(19).value;console.log('Abdul Rahman Kanj W'+r.getCell(8).value+': Prod%='+(typeof p==='number'?(p*100).toFixed(1)+'%':p)+' (W4 with Sprinklr break should be ~89.5%, NOT 100%)');}});
})().catch(e=>console.log('ERR',e.message));
