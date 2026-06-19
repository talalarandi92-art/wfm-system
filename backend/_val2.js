const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();
const f='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/4.April 26 SC - FILLED (new).xlsx';
await wb.xlsx.readFile(f); console.log('(new) re-read OK');
const w4=wb.getWorksheet('W4'); let qn=0,sample=[];
w4.eachRow((r,n)=>{if(n===1)return;const t=r.getCell(17).value;if(t&&/quiz/.test(String(t))){qn++;if(sample.length<4)sample.push(r.getCell(1).value);}});
console.log('W4 hdr Q:',w4.getCell(1,17).value,'| quiz-miss notes:',qn,sample);
const w5=wb.getWorksheet('W5'); let bn=0,s5=[];w5.eachRow((r,n)=>{if(n===1)return;const t=String(r.getCell(17).value||'');if(/bar score/.test(t)){bn++;if(s5.length<2)s5.push(r.getCell(1).value+': '+t);}});
console.log('W5 bar-score notes:',bn,s5);
})().catch(e=>console.log('ERR',e.message));
