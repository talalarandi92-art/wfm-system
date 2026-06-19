const ExcelJS=require('exceljs');
(async()=>{
  for(const [lbl,f,sheet] of [['APRIL','April 26 Scorecard - SCORED.xlsx','April SC'],['MAY','May 26 Scorecard - SCORED.xlsx','May SC']]){
    const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/'+f);
    const ws=wb.getWorksheet(sheet);
    let sme=0,smeAht=0;ws.eachRow((r,n)=>{if(n===1)return;if(/Social Media|Mail/i.test(String(r.getCell(4).value))&&/final/i.test(String(r.getCell(8).value))){sme++;if(r.getCell(15).value!=null&&r.getCell(15).value!=='')smeAht++;}});
    console.log(lbl+': SM&Email agents(Final)='+sme+' withAHT='+smeAht);
    // Abdallah Alfar
    let found='';ws.eachRow((r,n)=>{if(n===1||found)return;if(/alfar/i.test(String(r.getCell(1).value))&&/final/i.test(String(r.getCell(8).value))){const aht=r.getCell(15).value;found=r.getCell(1).value+' ('+r.getCell(4).value+') AHT='+(aht instanceof Date?aht.toISOString().slice(11,19):(aht??'∅'));}});
    console.log('  '+(found||'Alfar not found'));
  }
})().catch(e=>console.log('ERR',e.message));
