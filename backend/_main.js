const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx');
const sn=wb.worksheets.map(w=>w.name);console.log('sheets:',sn.join(' | '));
const ws=wb.worksheets.find(w=>/SC 26/.test(w.name))||wb.worksheets[0];console.log('main sheet:',ws.name);
// find header row (has 'Agent' & 'Weeks')
let hr=0;ws.eachRow((r,n)=>{if(hr)return;let hasA=false,hasW=false;r.eachCell(c=>{if(/^agent$/i.test(String(c.value)))hasA=true;if(/^weeks$/i.test(String(c.value)))hasW=true;});if(hasA&&hasW)hr=n;});
console.log('header row:',hr);
const h=ws.getRow(hr);let cols=[];h.eachCell((c,i)=>cols.push(i+':'+c.value));console.log('headers:',cols.join('  '));
// last used column
console.log('actualColumnCount:',ws.actualColumnCount,'| sample data row',hr+1,':',[2,3,8,9].map(i=>i+'='+JSON.stringify(ws.getRow(hr+1).getCell(i).value)).join(' '));
})().catch(e=>console.log(e.message));
