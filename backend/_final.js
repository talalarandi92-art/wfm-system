const ExcelJS=require('exceljs');
(async()=>{
for(const[lbl,f]of[['MAY','5.May 26 SC - FILLED.xlsx']]){
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/'+f);
const has=n=>!!wb.getWorksheet(n);
console.log(lbl,'sheets: Ranking='+has('Ranking'),'InternReview='+has('Intern Review'));
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));let qb=0;ws.eachRow((r,n)=>{if(n<14)return;if(/quiz: bar/.test(String(r.getCell(35).value||'')))qb++;});
console.log(lbl,'quiz-bar notes (W1-2):',qb);
const rk=wb.getWorksheet('Ranking');if(rk){let e=0;rk.eachRow((r,n)=>{if(n>1&&r.getCell(7).value==='Yes')e++;});console.log(lbl,'Ranking eligible rows:',e);}
}})().catch(e=>console.log('ERR',e.message));
