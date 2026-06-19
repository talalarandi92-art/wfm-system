const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('April SC');
let id=null;ws.eachRow((r,n)=>{if(n===1)return;const f=r.getCell(4).value;if(f==='Inbound'&&id===null)id=r.getCell(2).value;});
ws.eachRow((r,n)=>{if(n===1)return;if(r.getCell(2).value!==id)return;const wk=r.getCell(8).value;const fcr=r.getCell(17).value,fs=r.getCell(18).value,ctr=r.getCell(21).value,cs=r.getCell(22).value,net=r.getCell(7).value;const note=r.getCell(21).note;console.log(`W${wk}: FCR=${fcr??'∅'}(${fs??'∅'}) CTR=${ctr??'∅'}(${cs??'∅'}) Net=${net}${note?' [NOTE✓]':''}`);});
console.log('Ranking sheet?', !!wb.getWorksheet('Ranking'), '| top3:');
const rk=wb.getWorksheet('Ranking');[2,3,4].forEach(n=>{const r=rk.getRow(n);console.log('  #'+r.getCell(1).value,r.getCell(2).value,r.getCell(4).value,'Net='+r.getCell(6).value);});
})().catch(e=>console.log(e.message));
