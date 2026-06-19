const XLSX=require('xlsx');
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
// roster uids for ghadir/malak
const w1=XLSX.utils.sheet_to_json(XLSX.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx').Sheets['W1'],{header:1,defval:''}).slice(1);
const targets=w1.filter(r=>/ghadir|malak hamdan/i.test(String(r[0]))).map(r=>({name:r[0],uid:String(r[2]).toLowerCase()}));
console.log('roster:',JSON.stringify(targets));
// emails present in sprinklr break file
const rows=XLSX.utils.sheet_to_json(XLSX.readFile(D+'sprinklr april break.xlsx').Sheets['WhatsApp Login Logout'],{header:1,defval:''});
const hr=rows.findIndex(r=>String(r[0]).trim().toLowerCase()==='date');
const emails=new Set();for(let i=hr+1;i<rows.length;i++){const e=String(rows[i][1]||'').split('@')[0].toLowerCase().trim();if(e)emails.add(e);}
targets.forEach(t=>{
  const inFile=[...emails].filter(e=>e.includes(t.uid.split('.').pop())||t.uid.includes(e.split('.').pop()));
  console.log(t.name,'uid='+t.uid,'| exact in break file?',emails.has(t.uid),'| fuzzy candidates:',inFile.slice(0,5));
});
