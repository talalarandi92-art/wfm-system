const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5433, database:'wfm_db', user:'wfm_user', password:'WfmPass2025!' });
c.connect()
  .then(() => c.query("UPDATE users SET locked_until=NULL, status='active' WHERE email IN ('admin@boutiqaat.wfm','demo.admin@boutiqaat.wfm') RETURNING email,status"))
  .then(r => { console.log('Unlocked:', r.rows); return c.end(); })
  .catch(e => { console.error(e.message); c.end(); });
