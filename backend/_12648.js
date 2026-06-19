const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
  const ws=wb.getWorksheet('April SC');
  const fmt=v=>v instanceof Date?v.toISOString().slice(11,19):(v==null||v===''?'∅':v);
  ws.eachRow((r,n)=>{if(n===1)return;if(String(r.getCell(2).value)==='12648'){console.log('W'+r.getCell(8).value+': '+r.getCell(1).value+' ('+r.getCell(4).value+') AHT='+fmt(r.getCell(15).value)+' RT='+fmt(r.getCell(27).value)+' FCR='+fmt(r.getCell(17).value));}});
  // also: how many SM&Email have per-WEEK (W1) aht vs Final
  let w1=0,w1aht=0;ws.eachRow((r,n)=>{if(n===1)return;if(/Social Media|Mail/i.test(String(r.getCell(4).value))&&String(r.getCell(8).value)==='1'){w1++;if(fmt(r.getCell(15).value)!=='∅')w1aht++;}});
  console.log('SM&Email W1: '+w1+' agents, '+w1aht+' with AHT (April W1-3 = no Sprinklr → expected blank)');
})().catch(e=>console.log('ERR',e.message));
