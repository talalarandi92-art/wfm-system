const XLSX=require('xlsx');
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
const rows=XLSX.utils.sheet_to_json(XLSX.readFile(D+'sprinklr april break.xlsx').Sheets['WhatsApp Login Logout'],{header:1,defval:''});
const hr=rows.findIndex(r=>String(r[0]).trim().toLowerCase()==='date');
const em=new Set();for(let i=hr+1;i<rows.length;i++){const e=String(rows[i][1]||'').toLowerCase();if(e)em.add(e);}
console.log('emails matching hamdan/malak:',[...em].filter(e=>/hamdan|malak/.test(e)));
