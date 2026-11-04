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

  it('requires explicit clinician approval before activating a manual template', async () => {
    mockTables(supabaseAdmin, { profiles: profileRow('clinician') });
    const template = { id: '11111111-1111-4111-8111-111111111111', name: 'Test fixture', medications: [] };
    const omitted = await send('put', '/api/decision-support/templates').send({ template });
    expect(omitted.status).toBe(400);
    const stringFlag = await send('put', '/api/decision-support/templates').send({ template: { ...template, clinicianApproved: 'true' } });
    expect(stringFlag.status).toBe(400);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    supabaseAdmin.rpc.mockResolvedValue(ok({ id: template.id, status: 'active' }));
    const approved = await send('put', '/api/decision-support/templates').send({ template: { ...template, clinicianApproved: true } });
    expect(approved.status).toBe(200);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('save_medication_template', expect.objectContaining({ p_template: expect.objectContaining({ clinicianApproved: true }) }));
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

  it.each([
    ['unchanged with reordered jsonb keys', '1', false],
    ['changed dose', '2', true],
  ])('records an edit only for a changed draft item: %s', async (_name, dose, shouldUpdate) => {
    const feedbackId = '11111111-1111-4111-8111-111111111111';
    const draft = {
      medications: [{ name: 'TEST ITEM', dose, kind: 'medicine', source: { feedbackEventId: feedbackId } }],
      instructions: '', followUp: '', feedbackEventIds: [feedbackId],
    };
    const chains = mockTables(supabaseAdmin, {
      profiles: profileRow('clinician'),
      appointments: ok({ id: 'appointment-1', clinician_id: clinician.id, patient_id: 'patient-1' }),
      prescription_drafts: ok({ draft_content: draft, updated_at: '2026-11-02T00:00:00Z' }),
      medication_feedback_events: ok([{ id: feedbackId, recommendation_event_id: 'event-1', action: 'accepted', final_items: [{ kind: 'medicine', dose: '1', name: 'TEST ITEM' }] }]),
      medication_recommendation_events: ok([{ id: 'event-1', appointment_id: 'appointment-1' }]),
    });

    const response = await send('put', '/api/decision-support/appointments/appointment-1/draft').send({ draft });
    expect(response.status).toBe(200);
    expect(chains.medication_feedback_events.length).toBe(shouldUpdate ? 2 : 1);
    if (shouldUpdate) expect(chains.medication_feedback_events[1].update).toHaveBeenCalledWith(expect.objectContaining({ action: 'edited' }));
  });
});
