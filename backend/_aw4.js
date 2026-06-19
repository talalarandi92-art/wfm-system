const XLSX=require('xlsx');
const f='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/April week4.xlsx';
const wb=XLSX.readFile(f);
console.log('sheets:',wb.SheetNames.join(' | '));
for(const sn of wb.SheetNames.slice(0,4)){
  const r=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:''});
  console.log('\n['+sn+'] rows='+r.length);
  for(let i=0;i<Math.min(4,r.length);i++)console.log('  row'+i+':',JSON.stringify(r[i]).slice(0,220));
}
