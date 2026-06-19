const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
  const ws=wb.getWorksheet('April SC');           // cols: 11 RES, 12 PRRrate, 13 PRRpts, 14 PRRbonus
  const aud=wb.getWorksheet('DATA (audit)');       // has Tickets, SurveyYes, SurveyNo, RES, PRR per agent×week
  const pct=v=>typeof v==='number'?(v*100).toFixed(0)+'%':(v==null||v===''?'∅':v);
  let shown=0;
  ws.eachRow((r,n)=>{if(n===1||shown>=6)return;const res=r.getCell(11).value,prr=r.getCell(12).value,pts=r.getCell(13).value;
    const resNum=typeof res==='number',prrEmpty=(prr==null||prr==='');
    if((resNum&&prrEmpty)||(typeof prr==='number'&&(pts===''||pts==null))){
      console.log(r.getCell(1).value+' ('+r.getCell(4).value+') W'+r.getCell(8).value+': RES='+pct(res)+' PRRrate='+pct(prr)+' PRRpts='+(pts??'∅'));shown++;}
  });
  if(!shown)console.log('no RES-without-PRR rows found; checking PRR-with-zero-points...');
})().catch(e=>console.log('ERR',e.message));
