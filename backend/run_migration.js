const { Client } = require('pg');
const fs = require('fs');
const sql = fs.readFileSync('C:/Users/t.bassam/Desktop/WFM System/database/migrations/014_calendar_skills_notifications.sql', 'utf8');
const client = new Client({ host: 'localhost', port: 5433, user: 'wfm_user', password: 'WfmPass2025!', database: 'wfm_db' });
client.connect().then(() => client.query(sql)).then(() => { console.log('Migration 014 applied OK'); client.end(); }).catch(e => { console.error('ERROR:', e.message); client.end(); process.exit(1); });
