const ExcelJS=require('exceljs');
const F='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx';
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(F);
for(const ws of wb.worksheets){
  let hits=0;
  ws.eachRow((r,rn)=>{r.eachCell({includeEmpty:false},(c,cn)=>{
    const fill=c.fill;const hasColor=fill&&fill.type==='pattern'&&fill.fgColor&&fill.fgColor.argb&&!/FFFFFF|^FF000000$/.test(fill.fgColor.argb);
    const hasFormula=c.formula||c.value&&c.value.formula;
    const note=c.note;
    if((hasColor&&(hasFormula||c.value))||note){
      if(hits<25){const addr=c.address;const val=c.value&&c.value.formula?('=F:'+c.value.formula):JSON.stringify(c.value);console.log(`[${ws.name}] ${addr} fill=${hasColor?fill.fgColor.argb:'-'} ${note?'NOTE="'+(note.texts?note.texts.map(t=>t.text).join(''):note)+'" ':''}${val}`.slice(0,180));}
      hits++;
    }
  });});
  if(hits)console.log(`  → [${ws.name}] total colored/noted cells: ${hits}\n`);
}
})().catch(e=>console.log('ERR',e.message));
