const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/May 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('May SC');
let shown=0,id=null;
ws.eachRow((r,n)=>{if(n===1)return;const f=r.getCell(4).value;if(id===null&&f==='Inbound')id=r.getCell(2).value;});
ws.eachRow((r,n)=>{if(n===1||r.getCell(2).value!==id)return;const wk=r.getCell(8).value;const q=r.getCell(9).value;const qs=r.getCell(10).value;console.log('W'+wk+': Quality='+(typeof q==='number'?(q*100).toFixed(0)+'%':JSON.stringify(q))+' → score='+qs);});
console.log('--- BAR_QA in engine = 0.95; qaBarWeeks(may)=[1,2,3,4] ---');
// distribution of Quality across all May rows
const dist={};ws.eachRow((r,n)=>{if(n===1)return;const q=r.getCell(9).value;const k=typeof q==='number'?(q*100).toFixed(0)+'%':'blank';dist[k]=(dist[k]||0)+1;});
console.log('Quality value distribution:',JSON.stringify(dist));
})().catch(e=>console.log('ERR',e.message));
