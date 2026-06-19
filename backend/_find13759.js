const ExcelJS=require('exceljs');
(async()=>{
  for(const [lbl,f,sh] of [['SCORED-Apr','April 26 Scorecard - SCORED.xlsx','April SC'],['FILLED-Apr','4.April 26 SC - FILLED.xlsx',null]]){
    const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/'+f);
    const ws=sh?wb.getWorksheet(sh):wb.worksheets.find(w=>/SC 26/.test(w.name));
    let rows=[];const idCol=sh?2:3;const nmCol=sh?1:2;
    ws.eachRow((r,n)=>{if(String(r.getCell(idCol).value)==='13759')rows.push('row'+n+' name='+r.getCell(nmCol).value+' wk='+r.getCell(sh?8:9).value);});
    console.log(lbl+': 13759 rows='+rows.length, rows.slice(0,2).join(' | '));
  }
})().catch(e=>console.log('ERR',e.message));
