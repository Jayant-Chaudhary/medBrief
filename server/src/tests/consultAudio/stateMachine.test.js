/**
 * State Machine Unit Tests.
 */

const {
  STATES,
  ALLOWED_TRANSITIONS,
  isValidTransition,
  assertCanTransition,
} = require('../../services/consultAudio/stateMachine');

describe('Consult Audio State Machine', () => {
  describe('isValidTransition', () => {
    test('allows valid progressive transitions', () => {
      expect(isValidTransition(STATES.CREATED, STATES.WAITING)).toBe(true);
      expect(isValidTransition(STATES.WAITING, STATES.READY)).toBe(true);
      expect(isValidTransition(STATES.READY, STATES.RECORDING)).toBe(true);
      expect(isValidTransition(STATES.RECORDING, STATES.ENDING)).toBe(true);
      expect(isValidTransition(STATES.ENDING, STATES.PROCESSING)).toBe(true);
      expect(isValidTransition(STATES.PROCESSING, STATES.DRAFT_READY)).toBe(true);
    });

    test('allows cancellation or failure from pre-draft states', () => {
      expect(isValidTransition(STATES.CREATED, STATES.CANCELLED)).toBe(true);
      expect(isValidTransition(STATES.WAITING, STATES.CANCELLED)).toBe(true);
      expect(isValidTransition(STATES.READY, STATES.CANCELLED)).toBe(true);
      expect(isValidTransition(STATES.RECORDING, STATES.CANCELLED)).toBe(true);
      expect(isValidTransition(STATES.RECORDING, STATES.FAILED)).toBe(true);
      expect(isValidTransition(STATES.ENDING, STATES.FAILED)).toBe(true);
      expect(isValidTransition(STATES.PROCESSING, STATES.FAILED)).toBe(true);
    });

    test('rejects skipping states or backward transitions', () => {
      expect(isValidTransition(STATES.CREATED, STATES.READY)).toBe(false);
      expect(isValidTransition(STATES.CREATED, STATES.RECORDING)).toBe(false);
      expect(isValidTransition(STATES.WAITING, STATES.RECORDING)).toBe(false);
      expect(isValidTransition(STATES.RECORDING, STATES.DRAFT_READY)).toBe(false);
      expect(isValidTransition(STATES.DRAFT_READY, STATES.RECORDING)).toBe(false);
      expect(isValidTransition(STATES.CANCELLED, STATES.WAITING)).toBe(false);
      expect(isValidTransition(STATES.FAILED, STATES.WAITING)).toBe(false);
    });
  });

  describe('assertCanTransition (Preconditions)', () => {
    const baseSession = {
      id: 'sess-123',
      status: STATES.WAITING,
      patient_required: true,
    };

    test('rejects transition to READY if doctor consent is missing', () => {
      const consents = [{ role: 'patient' }];
      const devices = [
        { device: 'doctor', status: 'ready' },
        { device: 'patient', status: 'ready' },
      ];

      const res = assertCanTransition({
        session: baseSession,
        consents,
        devices,
        toState: STATES.READY,
      });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Doctor consent required/i);
    });

    test('rejects transition to READY if doctor device is not ready', () => {
      const consents = [{ role: 'doctor' }, { role: 'patient' }];
      const devices = [
        { device: 'doctor', status: 'joined' },
        { device: 'patient', status: 'ready' },
      ];

      const res = assertCanTransition({
        session: baseSession,
        consents,
        devices,
        toState: STATES.READY,
      });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Doctor device must be ready/i);
    });

    test('rejects transition to READY if patient is required but patient consent is missing', () => {
      const consents = [{ role: 'doctor' }];
      const devices = [
        { device: 'doctor', status: 'ready' },
        { device: 'patient', status: 'ready' },
      ];

      const res = assertCanTransition({
        session: baseSession,
        consents,
        devices,
        toState: STATES.READY,
      });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Patient consent required/i);
    });

    test('rejects transition to READY if patient is required but patient device is not ready', () => {
      const consents = [{ role: 'doctor' }, { role: 'patient' }];
      const devices = [
        { device: 'doctor', status: 'ready' },
        { device: 'patient', status: 'joined' },
      ];

      const res = assertCanTransition({
        session: baseSession,
        consents,
        devices,
        toState: STATES.READY,
      });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Patient device must be ready/i);
    });

    test('allows transition to READY when patient_required is false and doctor is ready', () => {
      const soloSession = { ...baseSession, patient_required: false };
      const consents = [{ role: 'doctor' }];
      const devices = [{ device: 'doctor', status: 'ready' }];

      const res = assertCanTransition({
        session: soloSession,
        consents,
        devices,
        toState: STATES.READY,
      });

      expect(res.valid).toBe(true);
    });

    test('allows transition to READY when all required devices and consents are ready', () => {
      const consents = [{ role: 'doctor' }, { role: 'patient' }];
      const devices = [
        { device: 'doctor', status: 'ready' },
        { device: 'patient', status: 'ready' },
      ];

      const res = assertCanTransition({
        session: baseSession,
        consents,
        devices,
        toState: STATES.READY,
      });

      expect(res.valid).toBe(true);
    });

    test('rejects transition to RECORDING if current state is not READY', () => {
      const sessionInWaiting = { ...baseSession, status: STATES.WAITING };
      const res = assertCanTransition({
        session: sessionInWaiting,
        consents: [{ role: 'doctor' }, { role: 'patient' }],
        devices: [{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'ready' }],
        toState: STATES.RECORDING,
      });

      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Cannot start recording|Invalid state transition/i);
    });

    test('allows transition to RECORDING when in READY with consents', () => {
      const sessionInReady = { ...baseSession, status: STATES.READY };
      const res = assertCanTransition({
        session: sessionInReady,
        consents: [{ role: 'doctor' }, { role: 'patient' }],
        devices: [{ device: 'doctor', status: 'ready' }, { device: 'patient', status: 'ready' }],
        toState: STATES.RECORDING,
      });

      expect(res.valid).toBe(true);
    });
  });
});
