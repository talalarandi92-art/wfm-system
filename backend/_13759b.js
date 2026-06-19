const XLSX=require('xlsx');
const SC='C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx';
const pr=XLSX.utils.sheet_to_json(XLSX.readFile(SC).Sheets['Productivity'],{header:1,defval:''});
const h=pr[0];const idCols=[];h.forEach((x,i)=>{if(String(x).trim().toLowerCase()==='id')idCols.push(i);});
const nameCols=[];h.forEach((x,i)=>{if(String(x).trim().toLowerCase()==='name')nameCols.push(i);});
let found=[];for(let i=1;i<pr.length;i++){for(let k=0;k<idCols.length;k++){if(String(pr[i][idCols[k]]).trim()==='13759'){found.push('block'+k+' name='+JSON.stringify(pr[i][nameCols[k]])+' func='+JSON.stringify(pr[i][idCols[k]+3]));}}}
console.log('13759 in April Productivity:',found.length?found.join(' | '):'NOT FOUND');
console.log('id cols:',idCols,'name cols:',nameCols);
