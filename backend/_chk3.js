const ExcelJS=require('exceljs');const XLSX=require('xlsx');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('April SC');
const show=(re,lbl)=>{let done=false;ws.eachRow((r,n)=>{if(n===1||done)return;if(re.test(String(r.getCell(1).value))&&/final/i.test(String(r.getCell(8).value))){const aht=r.getCell(15).value;const q=r.getCell(9).value;const qs=r.getCell(10).value;console.log(lbl+': '+r.getCell(4).value+' | AHT='+(aht instanceof Date?aht.toISOString().slice(11,19):(aht??'∅'))+' Quality='+(typeof q==='number'?(q*100).toFixed(0)+'%':'∅')+'('+(qs??'∅')+')');done=true;}});};
show(/fatemeh ameli|fatima ameli/i,'Fatemeh Ameli');
show(/abdallah alfar|abdullah alfar/i,'Abdallah Alfar');
// an OMT agent
let omt=false;ws.eachRow((r,n)=>{if(n===1||omt)return;if(r.getCell(4).value==='OMT'&&/final/i.test(String(r.getCell(8).value))){const aht=r.getCell(15).value;console.log('OMT '+r.getCell(1).value+' AHT='+(aht instanceof Date?aht.toISOString().slice(11,19):(aht??'∅')));omt=true;}});
// does April W4 CA contain SM&Email-type rows? check functions of matched agents
