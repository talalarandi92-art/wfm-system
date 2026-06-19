const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();
try{ await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/4.April 26 SC - FILLED.xlsx'); console.log('FILLED re-read OK (no parse error)'); }catch(e){console.log('FILLED read ERR',e.message);return;}
// W4 quiz-miss notes + W5 bar notes
const w4=wb.getWorksheet('W4'); let qn=0,sample=[];
w4.eachRow((r,n)=>{if(n===1)return;const t=r.getCell(17).value;if(t&&/quiz/.test(String(t))){qn++;if(sample.length<3)sample.push(r.getCell(1).value);}});
console.log('W4 quiz-miss notes:',qn,sample);
const w5=wb.getWorksheet('W5'); let bn=0;w5.eachRow((r,n)=>{if(n===1)return;if(/bar score/.test(String(r.getCell(17).value||'')))bn++;});
console.log('W5 bar-score notes:',bn,'| Q1 header:',w4.getCell(1,17).value);
})().catch(e=>console.log(e.message));
