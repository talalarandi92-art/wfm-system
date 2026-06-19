const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();
  await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
  const ws=wb.getWorksheet('April SC');
  const fmt=v=>v instanceof Date?v.toISOString().slice(11,19):(v==null||v===''?'∅':v);
  const show=(re,lbl)=>{let done=false;ws.eachRow((r,n)=>{if(n===1||done)return;if(re.test(String(r.getCell(1).value))&&/final/i.test(String(r.getCell(8).value))){console.log(lbl+': '+r.getCell(4).value+' | AHT='+fmt(r.getCell(15).value)+' Quality='+(typeof r.getCell(9).value==='number'?(r.getCell(9).value*100).toFixed(0)+'%':'∅')+'→'+fmt(r.getCell(10).value)+' RT='+fmt(r.getCell(27).value));done=true;}});};
  show(/fatemeh ameli|fatima ameli/i,'Fatemeh Ameli');
  show(/abdallah alfar|abdullah alfar/i,'Abdallah Alfar');
  let omt=false;ws.eachRow((r,n)=>{if(n===1||omt)return;if(r.getCell(4).value==='OMT'&&/final/i.test(String(r.getCell(8).value))){console.log('OMT '+r.getCell(1).value+' AHT='+fmt(r.getCell(15).value));omt=true;}});
})().catch(e=>console.log('ERR',e.message));
