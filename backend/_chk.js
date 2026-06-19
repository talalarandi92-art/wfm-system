const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('April SC');
const want=new Set([12375,12434]); // Haya, Shaima
const rows={};
ws.eachRow((r,n)=>{if(n===1)return;const id=r.getCell(2).value;const wk=r.getCell(8).value;const prod=r.getCell(19).value;const ps=r.getCell(20).value;const nm=r.getCell(1).value;if(want.has(id)){(rows[nm]=rows[nm]||[]).push(`W${wk}:prod=${typeof prod==='number'?(prod*100).toFixed(1)+'%':prod} score=${ps}`);}});
for(const k in rows)console.log(k+': '+rows[k].join('  '));
// also one voice agent (Inbound) to confirm not all 100%
let shown=0;ws.eachRow((r,n)=>{if(n===1||shown>=5)return;const f=r.getCell(4).value;const wk=r.getCell(8).value;if(f==='Inbound'&&wk===1){const prod=r.getCell(19).value;console.log('VOICE '+r.getCell(1).value+' W1 prod='+(typeof prod==='number'?(prod*100).toFixed(1)+'%':prod));shown++;}});
})().catch(e=>console.log('ERR',e.message));
