const XLSX=require('xlsx');
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
const rows=XLSX.utils.sheet_to_json(XLSX.readFile(D+'sprinklr april break.xlsx').Sheets['WhatsApp Login Logout'],{header:1,defval:''});
console.log('rows:',rows.length);
let hr=rows.findIndex(r=>r.some(c=>/agent email/i.test(String(c))));console.log('headerRow:',hr);
const H=rows[hr].map(x=>String(x).trim().toLowerCase());
console.log('cDate:',H.findIndex(s=>s==='date'),'cEmail:',H.findIndex(s=>/agent email/.test(s)),'cBio:',H.findIndex(s=>/bio break/.test(s)),'cTea:',H.findIndex(s=>/tea break/.test(s)),'cLun:',H.findIndex(s=>/lunch break/.test(s)));
// sample dates + month
for(let i=hr+1;i<hr+5;i++){const d=rows[i][0];const dt=new Date(Date.UTC(1899,11,30)+Math.floor(d)*86400000);console.log('date serial',d,'→',dt.toISOString().slice(0,10),'month(0idx)',dt.getUTCMonth());}
// distinct months across file
const months={};for(let i=hr+1;i<rows.length;i++){const d=rows[i][0];if(typeof d!=='number')continue;const m=new Date(Date.UTC(1899,11,30)+Math.floor(d)*86400000).getUTCMonth();months[m]=(months[m]||0)+1;}
console.log('month distribution:',JSON.stringify(months));
