const supabaseAdmin = require('../config/supabaseAdminClient');
const env = require('../config/env');

function isSelfVerifyPermitted() {
  if (typeof env.isSelfVerifyPermitted === 'function') {
    return env.isSelfVerifyPermitted();
  }
  const currentEnv = process.env.NODE_ENV || env.nodeEnv || 'development';
  if (currentEnv !== 'development' && currentEnv !== 'test') {
    return false;
  }
  return Boolean(env.demoSelfVerify);
}

function shapeProfile(profile, details, role) {
  const base = {
    id: profile.id,
    role: profile.role,
    fullName: profile.full_name,
    phone: profile.phone,
    createdAt: profile.created_at,
  };

  if (role === 'clinician') {
    const isVerified = details?.is_verified ?? false;
    const canSelfVerify = Boolean(isSelfVerifyPermitted() && !isVerified);
    return {
      ...base,
      specialty: details?.specialty ?? null,
      licenseNumber: details?.license_number ?? null,
      stateMedicalCouncil: details?.state_medical_council ?? null,
      isVerified,
      canSelfVerify,
    };
  }

  return {
    ...base,
    dateOfBirth: details?.date_of_birth ?? null,
    dueDate: details?.due_date ?? null,
    bloodType: details?.blood_type ?? null,
    address: details?.address ?? null,
    emergencyContactName: details?.emergency_contact_name ?? null,
    emergencyContactPhone: details?.emergency_contact_phone ?? null,
  };
}

function detailsTableFor(role) {
  return role === 'clinician'
    ? { table: 'clinician_details', key: 'profile_id' }
    : { table: 'patient_details', key: 'profile_id' };
}

async function getProfile(req, res, next) {
  try {
    const { id, role } = req.user;
    const { table, key } = detailsTableFor(role);

    const [{ data: profile, error: profileError }, { data: details }] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', id).single(),
      supabaseAdmin.from(table).select('*').eq(key, id).maybeSingle(),
    ]);

    if (profileError || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(shapeProfile(profile, details, role));
  } catch (err) {
    next(err);
  }
}

/** Only keys the caller actually sent are written, so a partial save cannot blank a field. */
function pickProvided(body, mapping) {
  const row = {};
  for (const [incoming, column] of Object.entries(mapping)) {
    if (incoming in body) row[column] = body[incoming];
  }
  return row;
}

async function updateProfile(req, res, next) {
  try {
    const { id, role } = req.user;
    const body = req.validated;

    const profileRow = pickProvided(body, { fullName: 'full_name', phone: 'phone' });
    if (Object.keys(profileRow).length > 0) {
      const { error } = await supabaseAdmin.from('profiles').update(profileRow).eq('id', id);
      if (error) throw error;
    }

    const detailMapping =
      role === 'clinician'
        ? {
            specialty: 'specialty',
            licenseNumber: 'license_number',
            stateMedicalCouncil: 'state_medical_council',
          }
        : {
            dateOfBirth: 'date_of_birth',
            dueDate: 'due_date',
            bloodType: 'blood_type',
            address: 'address',
            emergencyContactName: 'emergency_contact_name',
            emergencyContactPhone: 'emergency_contact_phone',
          };

    const detailRow = pickProvided(body, detailMapping);
    const { table, key } = detailsTableFor(role);

    if (Object.keys(detailRow).length > 0) {
      const { error } = await supabaseAdmin
        .from(table)
        .upsert({ [key]: id, ...detailRow }, { onConflict: key });
      if (error) throw error;
    }

    return getProfile(req, res, next);
  } catch (err) {
    next(err);
  }
}

/**
 * Demo only: a clinician marks their own account verified.
 *
 * Verification is normally an administrator's decision
 * (scripts/verifyClinician.js). This shortcut exists so a demo can go from
 * sign-up to dashboard without one, and refuses to run once
 * DEMO_SELF_VERIFY=false.
 */
async function demoVerify(req, res, next) {
  try {
    if (!isSelfVerifyPermitted()) {
      return res.status(403).json({ error: 'Self-verification is turned off. An administrator must verify you.' });
    }
    if (req.user.role !== 'clinician') {
      return res.status(403).json({ error: 'Only clinician accounts are verified' });
    }

    const { error } = await supabaseAdmin
      .from('clinician_details')
      .upsert({ profile_id: req.user.id, is_verified: true }, { onConflict: 'profile_id' });

    if (error) throw error;

    res.json({ isVerified: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile, updateProfile, shapeProfile, demoVerify };
