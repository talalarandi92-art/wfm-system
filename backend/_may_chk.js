const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/May 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('May SC');
const ids=new Set();const names=[];ws.eachRow((r,n)=>{if(n===1)return;const id=r.getCell(2).value;if(id&&!ids.has(id)){ids.add(id);names.push(r.getCell(1).value);}});
console.log('May SCORED distinct agents:',ids.size);
// new joiners present?
const nj=['Khaled Aliullah','Daoud Khatib','Hussein Atwi','Maya Khoujeh'];
console.log('new joiners present:',nj.filter(x=>names.some(nm=>String(nm).toLowerCase().includes(x.toLowerCase().split(' ')[0]))).join(', ')||'NONE');
// ranking sheet
const rk=wb.getWorksheet('Ranking');let elig=0,inelig=0;rk.eachRow((r,n)=>{if(n===1)return;const e=r.getCell(7).value;if(e==='Yes')elig++;else if(String(e).includes('No'))inelig++;});
console.log('Ranking: eligible='+elig+' ineligible(below bar)='+inelig);
// show CHAT top 3 from ranking
console.log('--- Ranking CHAT block (top rows) ---');let shown=0;rk.eachRow((r,n)=>{if(n===1||shown>=4)return;if(/CH - WA/.test(String(r.getCell(1).value))&&r.getCell(7).value==='Yes'){console.log('  #'+r.getCell(2).value,r.getCell(3).value,'Net='+r.getCell(5).value);shown++;}});
})().catch(e=>console.log('ERR',e.message));
