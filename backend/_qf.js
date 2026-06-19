const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx');
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name));
// Quality Score = col 11 (K). Find first data row (14) formula
const c=ws.getCell(14,11);
console.log('Quality Score (K14) formula:',JSON.stringify(c.value).slice(0,300));
// also the rubric thresholds (rows 0-10) for Quality — scan col with 95/0.95
for(let r=1;r<=11;r++){const vals=[];for(let cc=9;cc<=13;cc++){const v=ws.getCell(r,cc).value;if(v!==null&&v!=='')vals.push(cc+':'+JSON.stringify(v));}if(vals.length)console.log('row'+r+':',vals.join(' '));}
})().catch(e=>console.log('ERR',e.message));
