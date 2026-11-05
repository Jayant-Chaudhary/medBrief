import { describe, it, expect } from 'vitest';
import { assistantVisibleOn } from '../components/assistant/assistantRoutes';

describe('assistantVisibleOn', () => {
  it('shows for patients on their pages', () => {
    for (const path of ['/', '/reports', '/summary', '/profile', '/checkin/symptoms']) {
      expect(assistantVisibleOn(path, { role: 'patient' })).toBe(true);
    }
  });

  it('shows for verified doctors only', () => {
    expect(assistantVisibleOn('/clinician', { role: 'clinician', verified: true })).toBe(true);
    expect(assistantVisibleOn('/clinician/maternity', { role: 'clinician', verified: true })).toBe(true);
    expect(assistantVisibleOn('/clinician', { role: 'clinician', verified: false })).toBe(false);
    expect(assistantVisibleOn('/clinician', { role: 'clinician' })).toBe(false);
  });

  it('hides on sign-in, onboarding and community pages', () => {
    for (const path of ['/login', '/signup', '/invite/abc', '/onboarding/patient', '/verification-pending', '/community-care', '/maternity']) {
      expect(assistantVisibleOn(path, { role: 'patient' })).toBe(false);
    }
  });

  it('hides for unknown roles', () => {
    expect(assistantVisibleOn('/', { role: 'admin' })).toBe(false);
    expect(assistantVisibleOn('/', {})).toBe(false);
  });
});
