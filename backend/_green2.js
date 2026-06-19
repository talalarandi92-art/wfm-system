const ExcelJS=require('exceljs');
const F='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/5.May 26 SC..xlsx';
(async()=>{
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(F);
const GREEN=/92D050|00B050|C6EFCE|70AD47|A9D08E|008000|D8E4BC|EBF1DE|00FF00|CCFFCC/i;
for(const ws of wb.worksheets){
  ws.eachRow((r,rn)=>{r.eachCell({includeEmpty:false},(c,cn)=>{
    const fill=c.fill;const argb=fill&&fill.fgColor&&fill.fgColor.argb;
    const f=(c.value&&c.value.formula)||c.formula;
    const green=argb&&GREEN.test(argb);
    const divFormula=f&&(/\//.test(f)||/\*\s*[79]/.test(f));
    if(green||divFormula){console.log(`[${ws.name}] ${c.address} ${green?'GREEN('+argb+')':''} ${f?'=':''}${f||JSON.stringify(c.value)}`.slice(0,200));}
  });});
}
console.log('\n=== MAY Productivity W1 block full header (cols 1-26) ===');
const pr=wb.getWorksheet('Productivity');const h=pr.getRow(1);
let s=[];for(let i=1;i<=26;i++)s.push(i+':'+(h.getCell(i).value||''));console.log(s.join('  '));
console.log('row2 vals:', (()=>{let v=[];for(let i=1;i<=26;i++){let x=pr.getRow(2).getCell(i).value;v.push((x&&x.formula?('=F'):x));}return v.join(' | ');})());
})().catch(e=>console.log('ERR',e.message));
