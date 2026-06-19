const XLSX=require('xlsx');
const f='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/5.May 26 SC - FILLED.xlsx';
const wb=XLSX.read(require('fs').readFileSync(f),{type:'buffer',cellDates:false});
const sn=wb.SheetNames.find(n=>/SC/i.test(n));console.log('detected sheet (/SC/i):',sn);
const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:null});
console.log('header row 13 (idx12):',JSON.stringify(rows[12]).slice(0,90));
// parser COL1: name idx0, netPts idx6, week idx7, qualityScore idx9
const r=rows[13]; // first data row (idx13)
console.log('data row idx13: name[0]='+JSON.stringify(r[0])+' netPts[6]='+JSON.stringify(r[6])+' week[7]='+JSON.stringify(r[7])+' qScore[9]='+JSON.stringify(r[9]));
// count rows with numeric netPts
let withNet=0;for(let i=13;i<rows.length;i++){if(rows[i]&&typeof rows[i][6]==='number')withNet++;}
console.log('rows with numeric Net Points:',withNet);
