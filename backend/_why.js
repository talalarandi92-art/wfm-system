const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
  const ws=wb.getWorksheet('April SC');
  ws.eachRow((r,n)=>{if(n===1)return;if(String(r.getCell(2).value)==='12648'){const wd=r.getCell(6).value;console.log('Abdalla Elfar W'+r.getCell(8).value+': WD%='+(typeof wd==='number'?(wd*100).toFixed(0)+'%':(wd??'∅'))+' Net='+r.getCell(7).value);}});
  // May SM&Email W1 AHT
  const wb2=new ExcelJS.Workbook();await wb2.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/May 26 Scorecard - SCORED.xlsx');
  const ws2=wb2.getWorksheet('May SC');
  let w1=0,aht=0;ws2.eachRow((r,n)=>{if(n===1)return;if(/Social Media|Mail/i.test(String(r.getCell(4).value))&&String(r.getCell(8).value)==='1'){w1++;if(r.getCell(15).value!=null&&r.getCell(15).value!=='')aht++;}});
  console.log('MAY SM&Email W1: '+w1+' agents, '+aht+' with AHT');
})().catch(e=>console.log('ERR',e.message));
