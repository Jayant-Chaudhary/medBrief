const supabaseAdmin = require('../config/supabaseAdminClient');
const { findAuthUserByEmail, verifyPassword } = require('../services/authUsers.service');
const logger = require('../utils/logger');

/**
 * @desc   Describe an invite so the landing page can show what it is for
 *         before asking for a password. Public: the token is the secret.
 * @route  GET /api/auth/invite/:token
 */
async function getInvite(req, res, next) {
  try {
    const { data: invite, error } = await supabaseAdmin
      .from('appointment_invites')
      .select('patient_email, patient_full_name, expires_at, used_at, appointments ( scheduled_at )')
      .eq('token', req.params.token)
      .maybeSingle();

    if (error) throw error;
    if (!invite) return res.status(404).json({ error: 'Invite not found' });

    const expired = new Date(invite.expires_at) < new Date();

    // Whether the email already has an account decides what the page asks
    // for: a new password, or simply a sign-in.
    const isReturningPatient = Boolean(await findAuthUserByEmail(invite.patient_email));

    res.json({
      patientEmail: invite.patient_email,
      patientFullName: invite.patient_full_name,
      scheduledAt: invite.appointments?.scheduled_at ?? null,
      expiresAt: invite.expires_at,
      isUsed: Boolean(invite.used_at),
      isExpired: expired,
      isReturningPatient,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc   Accept an appointment invite token and set user password
 * @route  POST /auth/accept-invite
 */
async function acceptInvite(req, res, next) {
  try {
    const { token, password } = req.validated;

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('appointment_invites')
      .select('*, appointments ( id, patient_id, status )')
      .eq('token', token)
      .single();

    if (inviteError || !invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    if (invite.used_at) {
      return res.status(410).json({ error: 'This invite has already been used' });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invite has expired' });
    }

    let authUser = await findAuthUserByEmail(invite.patient_email);
    const isReturningPatient = Boolean(authUser);

    // Accepting links this account to the clinician, which opens the
    // patient's records to them. A returning patient consents by confirming
    // their own current password; the invite token alone is not enough.
    if (isReturningPatient) {
      const passwordOk = await verifyPassword(invite.patient_email, password);
      if (!passwordOk) {
        return res.status(401).json({ error: 'That password is not correct for this account.' });
      }
    }

    if (!authUser) {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: invite.patient_email,
        password,
        email_confirm: true,
        user_metadata: { full_name: invite.patient_full_name || null },
      });
      if (createError) {
        return res.status(500).json({ error: `Failed to create account: ${createError.message}` });
      }
      authUser = created.user;
    }

    // A returning patient's password is checked above, never set: setting it
    // from an invite token would let anyone holding a forwarded invite email
    // take over the account.

    // Create the profile only if there isn't one. Upserting would overwrite a
    // returning patient's own name and phone with the invite's values.
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', authUser.id)
      .maybeSingle();

    if (existingProfile && existingProfile.role !== 'patient') {
      return res.status(409).json({ error: 'This email belongs to a staff account and cannot accept a patient invite.' });
    }

    if (!existingProfile) {
      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: authUser.id,
        role: 'patient',
        full_name: invite.patient_full_name || null,
      });

      if (profileError) {
        return res.status(500).json({ error: `Failed to create profile: ${profileError.message}` });
      }

      await supabaseAdmin.from('patient_details').upsert({ profile_id: authUser.id });
    } else if (!existingProfile.full_name && invite.patient_full_name) {
      // Fill a blank name, never replace one the patient has set.
      await supabaseAdmin
        .from('profiles')
        .update({ full_name: invite.patient_full_name })
        .eq('id', authUser.id);
    }

    // Linking the patient is what moves the visit out of `invited`: until
    // then the clinician has nobody to open a record for.
    const appointmentChanges = {};
    if (!invite.appointments.patient_id) appointmentChanges.patient_id = authUser.id;
    if (invite.appointments.status === 'invited') appointmentChanges.status = 'active';

    if (Object.keys(appointmentChanges).length > 0) {
      await supabaseAdmin
        .from('appointments')
        .update(appointmentChanges)
        .eq('id', invite.appointments.id);
    }

    await supabaseAdmin
      .from('appointment_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id);

    res.status(200).json({
      message: isReturningPatient
        ? 'This appointment has been added to your account.'
        : 'Account ready. You can now log in with your new password.',
      email: invite.patient_email,
      appointmentId: invite.appointments.id,
      isReturningPatient,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc   Get details of an invite token (e.g. email)
 * @route  GET /auth/invite/:token
 */
async function getInviteDetails(req, res, next) {
  try {
    const { token } = req.params;

    const { data: invite, error } = await supabaseAdmin
      .from('appointment_invites')
      .select('patient_email, used_at, expires_at')
      .eq('token', token)
      .single();

    if (error || !invite) {
      return res.status(404).json({ error: 'Invite link is invalid or expired' });
    }

    if (invite.used_at) {
      return res.status(410).json({ error: 'This invite has already been used' });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invite has expired' });
    }

    res.status(200).json({ email: invite.patient_email });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc   Register a user directly (Patient/Clinician)
 * @route  POST /auth/signup
 */
async function signup(req, res, next) {
  try {
    const { email, password, fullName, role = 'patient', phone } = req.validated;

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    });

    if (createError) {
      return res.status(400).json({ error: createError.message });
    }

    const user = created.user;

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: user.id,
        role: role,
        full_name: fullName || '',
        phone: phone || '',
      });

    if (profileError) {
      (req.log || logger).error('profile upsert failed during signup', { userId: user.id, role, err: profileError });
    }

    if (role === 'patient') {
      await supabaseAdmin.from('patient_details').upsert({ profile_id: user.id });
    } else if (role === 'clinician') {
      await supabaseAdmin.from('clinician_details').upsert({ profile_id: user.id });
    }

    res.status(201).json({
      message: 'Signup successful',
      user: { id: user.id, email: user.email, role, fullName },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc   Log out current session
 * @route  POST /auth/logout
 */
async function logout(req, res) {
  res.status(200).json({ message: 'Logout successful' });
}

/**
 * @desc   Get current authenticated user profile
 * @route  GET /auth/me
 */
async function getMe(req, res) {
  res.status(200).json({ user: req.user });
}

module.exports = { acceptInvite, signup, logout, getMe,
  getInvite,
};
