const ExcelJS=require('exceljs');
(async()=>{
  for(const [lbl,scored,scSheet,filled] of [
    ['APRIL','April 26 Scorecard - SCORED.xlsx','April SC','4.April 26 SC - FILLED.xlsx'],
    ['MAY','May 26 Scorecard - SCORED.xlsx','May SC','5.May 26 SC - FILLED.xlsx']]){
    const ws=new ExcelJS.Workbook();await ws.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/'+scored);
    const sc=ws.getWorksheet(scSheet);const scIds=new Set();sc.eachRow((r,n)=>{if(n>1)scIds.add(Number(r.getCell(2).value));});
    const wf=new ExcelJS.Workbook();await wf.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/'+filled);
    const main=wf.worksheets.find(w=>/SC 26/.test(w.name));let hr=0;main.eachRow((r,n)=>{if(hr)return;let a=false,w=false;r.eachCell(c=>{if(/^agent$/i.test(String(c.value)))a=true;if(/^weeks$/i.test(String(c.value)))w=true;});if(a&&w)hr=n;});
    const extra=[];const seen=new Set();main.eachRow((r,n)=>{if(n<=hr)return;const id=Number(r.getCell(3).value);if(!id||isNaN(id)||seen.has(id))return;seen.add(id);if(!scIds.has(id))extra.push(r.getCell(2).value+' (#'+id+', '+r.getCell(5).value+')');});
    console.log(lbl+' extra-in-FILLED ('+extra.length+'): '+extra.join(' | '));
  }
})().catch(e=>console.log('ERR',e.message));
