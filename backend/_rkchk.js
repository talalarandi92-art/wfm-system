const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/May 26 Scorecard - SCORED.xlsx');
const rk=wb.getWorksheet('Ranking');let internInRank=0,withWhy=0,funcs=new Set();
rk.eachRow((r,n)=>{if(n===1)return;const fn=String(r.getCell(1).value||'');if(/intern/i.test(fn))internInRank++;if(fn)funcs.add(fn);if(r.getCell(8).value)withWhy++;});
console.log('Ranking: interns leaked='+internInRank+' | funcs='+[...funcs].join(', '));
// top of CH-WA with Why
console.log('--- CH-WA top (Net + Why) ---');let s=0;rk.eachRow((r,n)=>{if(n===1||s>=3)return;if(r.getCell(1).value==='CH - WA'&&r.getCell(7).value==='Yes'){console.log('  #'+r.getCell(2).value,r.getCell(3).value,'Net='+r.getCell(5).value,'| '+r.getCell(8).value);s++;}});
const iv=wb.getWorksheet('Intern Review');
if(iv){let keep=0,letgo=0,rev=0,samp=[];iv.eachRow((r,n)=>{if(n===1)return;const rec=r.getCell(6).value;if(rec==='Keep')keep++;else if(rec==='Let go')letgo++;else if(rec==='Review')rev++;if(samp.length<3&&rec)samp.push(r.getCell(1).value+': '+rec+' ('+r.getCell(7).value+')');});
console.log('Intern Review: Keep='+keep+' Review='+rev+' LetGo='+letgo);samp.forEach(x=>console.log('  '+x));}
else console.log('NO Intern Review sheet');
})().catch(e=>console.log('ERR',e.message));
