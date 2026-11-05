// Synthetic staging fixtures. These are not prescriptions or clinical rules.
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('../../server/node_modules/@supabase/supabase-js');
const dotenv = require('../../server/node_modules/dotenv');

const serverDir = path.resolve(__dirname, '../../server');
const stage = dotenv.parse(fs.readFileSync(path.join(serverDir, '.env.staging')));
const existing = dotenv.parse(fs.readFileSync(path.join(serverDir, '.env')));
if (new URL(stage.SUPABASE_URL).host === new URL(existing.SUPABASE_URL).host) throw new Error('Staging target is not separate');
const db = createClient(stage.SUPABASE_URL, stage.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const rules = [
  ['Hb at most 10', [{ factorId: 'hemoglobin', label: 'Haemoglobin', operator: 'max', value: '10', unit: 'g/dL', required: true }]],
  ['Hb at least 11', [{ factorId: 'hemoglobin', label: 'Haemoglobin', operator: 'min', value: '11', unit: 'g/dL', required: true }]],
  ['TSH at most 3', [{ factorId: 'tsh', label: 'TSH', operator: 'max', value: '3', unit: 'µIU/mL', required: true }]],
  ['TSH at least 5', [{ factorId: 'tsh', label: 'TSH', operator: 'min', value: '5', unit: 'µIU/mL', required: true }]],
  ['Blood group O+', [{ factorId: 'blood_group', label: 'Blood group and RhD status', operator: 'equals', value: 'O+', unit: '', required: true }]],
  ['Blood group A+', [{ factorId: 'blood_group', label: 'Blood group and RhD status', operator: 'equals', value: 'A+', unit: '', required: true }]],
  ['Two-factor comparison', [{ factorId: 'hemoglobin', label: 'Haemoglobin', operator: 'min', value: '11', unit: 'g/dL', required: true }, { factorId: 'tsh', label: 'TSH', operator: 'max', value: '3', unit: 'µIU/mL', required: true }]],
];
(async () => {
  const users = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) throw users.error;
  const matches = users.data.users.filter(u => u.email === 'healthon-staging-doctor-25898116@mailinator.com');
  if (matches.length !== 1) throw new Error('Expected one synthetic clinician');
  const clinician = matches[0].id;
  const profile = await db.from('profiles').select('full_name,role').eq('id', clinician).single();
  if (profile.error || profile.data.role !== 'clinician' || !profile.data.full_name.startsWith('TEST CLINICIAN')) throw new Error('Synthetic clinician check failed');
  for (const [name, factorRules] of rules) {
    const template = {
      id: randomUUID(), name: `TEST ONLY - SIMULATED APPROVAL - ${name}`,
      purpose: '', required: '', optional: '', exclusions: '', minAge: '', maxAge: '', pregnancy: '',
      medications: [{ id: randomUUID(), name: 'TEST PLACEHOLDER - NOT A MEDICINE', kind: 'medicine', dose: '', frequency: '', duration: '', instructions: 'Synthetic test item; do not prescribe.' }],
      instructions: 'SYNTHETIC TEST ONLY - no clinical approval or treatment advice.', followUp: '', factorRules,
      clinicianApproved: true, archived: false,
    };
    const { data, error } = await db.rpc('save_medication_template', { p_clinician_id: clinician, p_template: template });
    if (error) throw error;
    if (data.status !== 'active') throw new Error('Unexpected test template status');
    console.log(`Created test fixture: ${name}`);
  }
})().catch(error => { console.error('Test fixture creation failed:', error.message); process.exitCode = 1; });
