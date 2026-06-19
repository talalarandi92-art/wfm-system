const XLSX=require('xlsx');
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
// roster uids for the 2
const w1=XLSX.utils.sheet_to_json(XLSX.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx').Sheets['W1'],{header:1,defval:''}).slice(1);
w1.filter(r=>/elfar|messelmani|alfar/i.test(String(r[0]))).forEach(r=>console.log('roster:',r[0],'ID',r[1],'uid',r[2]));
// emails in april break file
const rows=XLSX.utils.sheet_to_json(XLSX.readFile(D+'sprinklr april break.xlsx').Sheets['WhatsApp Login Logout'],{header:1,defval:''});
const hr=rows.findIndex(r=>String(r[0]).trim().toLowerCase()==='date');
const em=new Set();for(let i=hr+1;i<rows.length;i++){const e=String(rows[i][1]||'').toLowerCase();if(e)em.add(e);}
console.log('emails ~elfar/alfar/messel/mohamad:',[...em].filter(e=>/elfar|alfar|messel|mohamad|m\.mes/.test(e)).slice(0,10));
