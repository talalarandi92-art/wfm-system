const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/May 26 Scorecard - SCORED.xlsx');
  const ws=wb.getWorksheet('May SC');const T=v=>v instanceof Date?v.toISOString().slice(11,19):(v==null||v===''?'∅':v);
  // a CH-WA agent across weeks
  let id=null;ws.eachRow((r,n)=>{if(n===1||id)return;if(/CH - WA/.test(String(r.getCell(4).value)))id=r.getCell(2).value;});
  ws.eachRow((r,n)=>{if(n===1||r.getCell(2).value!==id)return;console.log('CH-WA W'+r.getCell(8).value+': AHT='+T(r.getCell(15).value)+' FRT='+T(r.getCell(27).value)+' FCR='+T(r.getCell(17).value));});
  // audit tab non-empty?
  const aud=wb.getWorksheet('DATA (audit)');let rows=0,withAht=0;aud.eachRow((r,n)=>{if(n===1)return;rows++;if(r.getCell(14).value!=null&&r.getCell(14).value!=='')withAht++;});
  console.log('May DATA(audit): rows='+rows+' withAHT='+withAht);
})().catch(e=>console.log('ERR',e.message));
