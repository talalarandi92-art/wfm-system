const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
  const aud=wb.getWorksheet('DATA (audit)');
  aud.eachRow((r,n)=>{if(n===1)return;if(String(r.getCell(2).value)==='13758'&&[1,2,3].includes(r.getCell(4).value)){
    const pc=v=>typeof v==='number'?(v*100).toFixed(0)+'%':v;
    console.log('Abdul Rahman Kanj W'+r.getCell(4).value+': Tickets='+r.getCell(7).value+' Yes='+r.getCell(10).value+' No='+r.getCell(11).value+' RES='+pc(r.getCell(12).value)+' PRR='+pc(r.getCell(13).value));}});
})().catch(e=>console.log('ERR',e.message));
