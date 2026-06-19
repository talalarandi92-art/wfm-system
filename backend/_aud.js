const ExcelJS=require('exceljs');
(async()=>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
  const aud=wb.getWorksheet('DATA (audit)');
  // header: Agent,ID,Function,Week,VoiceConnected,#Chats,Tickets,Closed,FCR,SurveyYes,SurveyNo,RES,PRR,AHT,FRT,QA,Quiz,WD%,Prod%
  const hdr=[];aud.getRow(1).eachCell((c,i)=>hdr[i]=c.value);
  console.log('cols:',[7,10,11,12,13].map(i=>i+':'+hdr[i]).join(' '));
  aud.eachRow((r,n)=>{if(n===1)return;if(/haya mohanna/i.test(String(r.getCell(1).value))&&[1,2,3].includes(r.getCell(4).value)){
    console.log('Haya W'+r.getCell(4).value+': Tickets='+r.getCell(7).value+' Yes='+r.getCell(10).value+' No='+r.getCell(11).value+' RES='+JSON.stringify(r.getCell(12).value)+' PRR='+JSON.stringify(r.getCell(13).value));}});
})().catch(e=>console.log('ERR',e.message));
