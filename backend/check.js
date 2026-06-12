const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5433, user: 'wfm_user', password: 'WfmPass2025!', database: 'wfm_db' });
client.connect().then(() => client.query("SELECT column_name FROM information_schema.columns WHERE table_name='skills' ORDER BY ordinal_position")).then(r => { r.rows.forEach(row => console.log(row.column_name)); client.end(); }).catch(e => { console.error(e.message); client.end(); });
