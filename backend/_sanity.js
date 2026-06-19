const ExcelJS=require('exceljs');
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April 26 Scorecard - SCORED.xlsx');
const ws=wb.getWorksheet('April SC');
const buckets={'100%':0,'95-99':0,'90-94':0,'80-89':0,'<80':0,'blank':0};
const susp=[];
ws.eachRow((r,n)=>{if(n===1)return;const wk=r.getCell(8).value;if(wk!==4)return;const p=r.getCell(19).value;const f=r.getCell(4).value;const nm=r.getCell(1).value;
  if(typeof p!=='number'){buckets.blank++;return;}
  const pc=p*100;
  if(pc>=99.95){buckets['100%']++;susp.push(nm+' ('+f+') 100%');}
  else if(pc>=95)buckets['95-99']++;else if(pc>=90)buckets['90-94']++;else if(pc>=80)buckets['80-89']++;else buckets['<80']++;
});
console.log('W4 prod buckets:',JSON.stringify(buckets));
console.log('W4 = 100% (break=0, suspicious):',susp.length); susp.slice(0,15).forEach(s=>console.log('  '+s));
})().catch(e=>console.log(e.message));
