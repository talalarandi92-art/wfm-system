const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('April SC');
function dump(matchFn,label){let id=null;ws.eachRow((r,n)=>{if(n===1)return;if(id===null&&matchFn(r.getCell(4).value))id=r.getCell(2).value;});
  console.log('\n=== '+label+' (ID '+id+') ===');
  ws.eachRow((r,n)=>{if(n===1||r.getCell(2).value!==id)return;const wk=r.getCell(8).value;const prod=r.getCell(19).value,ps=r.getCell(20).value;const fcr=r.getCell(17).value,fs=r.getCell(18).value;const ctr=r.getCell(21).value,cs=r.getCell(22).value;const net=r.getCell(7).value;
    console.log(`W${wk}: Prod=${typeof prod==='number'?(prod*100).toFixed(0)+'%':'∅'}(${ps??'∅'}) FCR=${typeof fcr==='number'?(fcr*100).toFixed(0)+'%':'∅'}(${fs??'∅'}) CTR=${typeof ctr==='number'?(ctr*100).toFixed(0)+'%':'∅'}(${cs??'∅'}) → Net=${net}`);});}
dump(f=>f==='Inbound','VOICE (Inbound)');
dump(f=>/CH - WA/.test(f),'CHAT (CH-WA)');
})().catch(e=>console.log(e.message));
