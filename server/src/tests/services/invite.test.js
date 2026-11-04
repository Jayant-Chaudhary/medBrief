jest.mock('nodemailer', () => {
  return {
    createTransport: jest.fn().mockReturnValue({
      sendMail: jest.fn().mockResolvedValue(true),
    }),
  };
});

jest.mock('../../config/supabaseAdminClient', () => ({
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: null, error: null }),
}));

jest.mock('../../config/env', () => ({
  smtp: { host: 'smtp.mailtrap.io', port: 2525, user: 'user', pass: 'pass', from: 'test@healthon.com' },
  inviteTokenTtlHours: 48,
  clientAppUrl: 'http://localhost:3000',
}));

const nodemailer = require('nodemailer');
const supabaseAdmin = require('../../config/supabaseAdminClient');
const { createAndSendInvite } = require('../../services/invite.service');
const logger = require('../../utils/logger');

describe('Invite Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createAndSendInvite()', () => {
    it('should generate token, insert into DB, and send email', async () => {
      const mockInvite = { id: 'invite-1', token: 'mock-token' };
      supabaseAdmin.single.mockResolvedValue({ data: mockInvite, error: null });

      const transport = nodemailer.createTransport();

      const result = await createAndSendInvite({
        appointmentId: 'appt-1',
        patientEmail: 'patient@example.com',
        patientFullName: 'John Doe',
      });

      expect(supabaseAdmin.insert).toHaveBeenCalled();
      
      const insertArg = supabaseAdmin.insert.mock.calls[0][0];
      expect(insertArg).toHaveProperty('appointment_id', 'appt-1');
      expect(insertArg).toHaveProperty('patient_email', 'patient@example.com');
      expect(insertArg).toHaveProperty('token'); // Dynamically generated
      expect(insertArg).toHaveProperty('expires_at');

      expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'patient@example.com',
        subject: 'Your appointment is confirmed — set up your account',
      }));

      // The link is returned so the clinician UI can hand it over if SMTP fails.
      expect(result).toEqual({ ...mockInvite, inviteLink: expect.stringMatching(/\/invite\/[0-9a-f]{64}$/) });
    });

    it('should throw error if db insert fails', async () => {
      supabaseAdmin.single.mockResolvedValue({ data: null, error: { message: 'DB Insert Error' } });

      await expect(createAndSendInvite({
        appointmentId: 'appt-1',
        patientEmail: 'patient@example.com',
      })).rejects.toThrow('Failed to create invite: DB Insert Error');
    });

    it('should swallow email transport errors and still return invite', async () => {
      const mockInvite = { id: 'invite-1', token: 'mock-token' };
      supabaseAdmin.single.mockResolvedValue({ data: mockInvite, error: null });

      const transport = nodemailer.createTransport();
      transport.sendMail.mockRejectedValue(new Error('Network timeout'));

      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});

      const result = await createAndSendInvite({
        appointmentId: 'appt-1',
        patientEmail: 'patient@example.com',
      });

      // The link is returned so the clinician UI can hand it over if SMTP fails.
      expect(result).toEqual({ ...mockInvite, inviteLink: expect.stringMatching(/\/invite\/[0-9a-f]{64}$/) });
      expect(warnSpy).toHaveBeenCalledWith(
        'could not send invite email via SMTP; invite token was still created',
        expect.objectContaining({ scope: 'invite', appointmentId: 'appt-1', error: 'Network timeout' })
      );

      // Verify debug logs never print the secret token or full URL
      for (const call of debugSpy.mock.calls) {
        expect(call[0]).not.toContain('/invite/');
        expect(call[0]).not.toContain(result.token);
      }

      warnSpy.mockRestore();
      debugSpy.mockRestore();
    });
  });
});
