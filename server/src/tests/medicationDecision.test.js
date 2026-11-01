const request = require('supertest');
const app = require('../app');
const supabaseAdmin = require('../config/supabaseAdminClient');
const { ok, mockTables, profileRow } = require('./helpers/supabaseMock');

jest.mock('../config/supabaseAdminClient', () => ({
  auth: { getUser: jest.fn() },
  from: jest.fn(),
  rpc: jest.fn(),
}));

describe('Medication decision support persistence API', () => {
  const clinician = { id: 'clinician-1', email: 'dr@example.com' };
  const send = (method, path) => request(app)[method](path).set('Authorization', 'Bearer t');

  beforeEach(() => {
    jest.clearAllMocks();
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: clinician }, error: null });
  });

  it('returns database templates with database allergy association keys', async () => {
    mockTables(supabaseAdmin, {
      profiles: profileRow('clinician'),
      medication_templates: ok([{
        id: 'template-1', title: 'Example', status: 'active', version: 1,
        template_content: { medications: [{ id: 'item-1', name: 'Example medicine' }] },
        medication_template_items: [{ id: 'item-1', ingredient_key: 'example-key', allergy_substance_keys: ['example-allergen'] }],
      }]),
      medication_allergen_associations: ok([{ medication_key: 'example-key', allergen_key: 'example-allergen', allergen_display: 'Example allergen', association_type: 'ingredient' }]),
      medication_feedback_events: ok([]),
    });

    const response = await send('get', '/api/decision-support/templates');
    expect(response.status).toBe(200);
    expect(response.body[0].medications[0]).toMatchObject({ ingredientKey: 'example-key', allergySubstanceKeys: ['example-allergen'], allergyAssociations: [{ substance_display: 'Example allergen' }] });
  });

  it('validates clinician allergy records before writing through the protected database function', async () => {
    mockTables(supabaseAdmin, {
      profiles: profileRow('clinician'),
      appointments: ok({ id: 'appointment-1', clinician_id: clinician.id, patient_id: 'patient-1' }),
    });
    supabaseAdmin.rpc.mockResolvedValue({ data: { status: 'allergies_documented' }, error: null });

    const response = await send('put', '/api/decision-support/appointments/appointment-1/allergies').send({
      status: 'allergies_documented',
      allergies: [{ substance_key: 'penicillin', substance_display: 'Penicillin', reaction: 'Rash' }],
    });
    expect(response.status).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('save_patient_allergies', expect.objectContaining({ p_clinician_id: clinician.id, p_status: 'allergies_documented' }));

    const invalid = await send('put', '/api/decision-support/appointments/appointment-1/allergies').send({ status: 'allergies_documented', allergies: [] });
    expect(invalid.status).toBe(400);
  });

  it('rejects a clinician who does not own the visit before accessing allergy data', async () => {
    mockTables(supabaseAdmin, {
      profiles: profileRow('clinician'),
      appointments: ok({ id: 'appointment-1', clinician_id: 'someone-else', patient_id: 'patient-1' }),
    });
    const response = await send('put', '/api/decision-support/appointments/appointment-1/allergies').send({ status: 'none_known', allergies: [] });
    expect(response.status).toBe(403);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});
