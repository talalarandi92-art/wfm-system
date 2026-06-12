const { Client } = require('pg');
const c = new Client({ host:'localhost', port:5433, database:'wfm_db', user:'wfm_user', password:'WfmPass2025!' });

c.connect().then(async () => {
  const adminId  = 'd1000000-0000-0000-0000-000000000005';
  const typeId   = '6d70ebce-108c-4da5-9b43-7b9fb87eb904'; // CRM Outage
  const tenantId = 'a0000000-0000-0000-0000-000000000001';

  const res = await c.query(`
    INSERT INTO outages (
      id, tenant_id, outage_type_id, title, description, severity, status,
      started_at, root_cause, impact_description,
      assigned_to, reported_by, sla_target_minutes, sla_due_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1, $2,
      'عطل CRM — تعذّر تحديث حالات العملاء',
      'يواجه الإيجنت خطأ 503 عند محاولة حفظ حالة الكيس في سيستم CRM. تأثر جميع الإيجنت في قسم Customer Care وRefund.',
      'high', 'in_progress',
      NOW() - INTERVAL '42 minutes',
      'تحديث مكتبة API في الـ CRM أدى إلى incompatibility مع الـ session handler',
      'تعذّر على 18 إيجنت إغلاق الكيسات — الكيسات تبقى open وتؤثر على SLA والـ FCR',
      $3, $3,
      60,
      NOW() + INTERVAL '18 minutes',
      NOW(), NOW()
    ) RETURNING id, title
  `, [tenantId, typeId, adminId]);

  console.log('✅ Created:', res.rows[0].id, '|', res.rows[0].title);
  await c.end();
}).catch(e => { console.error('❌', e.message); c.end(); });
