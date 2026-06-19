const ExcelJS=require('exceljs');
const names={6:'WD%',9:'Quality',11:'RES',12:'PRR',17:'FCR',19:'Prod',21:'CTR',23:'Quiz'};
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('April SC');
ws.eachRow((r,n)=>{if(n===1)return;[6,9,11,12,17,19,21,23].forEach(c=>{const v=r.getCell(c).value;if(typeof v==='number'&&(v<0||v>1.0001))console.log(r.getCell(1).value,'W'+r.getCell(8).value,names[c]+'='+(v*100).toFixed(1)+'%');});});
})().catch(e=>console.log(e.message));
