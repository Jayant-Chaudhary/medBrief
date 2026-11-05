import { expect, it, vi } from 'vitest';
vi.mock('../services/apiClient', () => ({ request: vi.fn(async () => ({ type: 'answer' })) }));
import { request } from '../services/apiClient';
import { assistantService } from '../services/assistantService';

it('submits a patient lookup choice with the original question and cancellation signal', async () => {
  const patientChoice = { id: 'synthetic-p', token: 'synthetic-signed-token' };
  const controller = new AbortController();
  await assistantService.ask('What is Asha Example\'s ferritin?', '/clinician/patients', {
    patientChoice, round: 0, signal: controller.signal,
  });
  expect(request).toHaveBeenCalledWith('/api/assistant/step', expect.objectContaining({
    signal: controller.signal, body: expect.objectContaining({ patientChoice, round: 0,
      message: 'What is Asha Example\'s ferritin?' }),
  }));
});
