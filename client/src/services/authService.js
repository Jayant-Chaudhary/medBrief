import { supabase } from './supabaseClient.js';
import { request } from './apiClient.js';

export async function acceptInvite(token, password) {
  return request('/api/auth/accept-invite', {
    method: 'POST',
    body: { token, password },
  });
}

export async function getInviteDetails(token) {
  return request(`/api/auth/invite/${token}`);
}

export async function signUpUser(param1, param2, param3) {
  let email, password, role;
  if (typeof param1 === 'string') {
    email = param1;
    password = param2;
    role = param3 || 'patient';
  } else if (param1 && typeof param1 === 'object') {
    if (typeof param1.email === 'object' && param1.email?.email) {
      email = param1.email.email;
      password = param1.email.password || param1.password;
      role = param1.email.role || param1.role || 'patient';
    } else {
      email = param1.email;
      password = param1.password;
      role = param1.role || 'patient';
    }
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: role,
        },
      },
    });

    if (authError) {
      console.error('[SignUp Error]:', authError.message);
      return { user: null, session: null, error: authError };
    }

    const user = authData.user;
    if (!user) {
      return { user: null, session: null, error: new Error('User creation returned empty user.') };
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        role: role,
      });

    if (profileError) {
      console.error('[Profile Creation Warning]:', profileError.message);
    }

    if (role === 'patient') {
      await supabase
        .from('patient_details')
        .upsert({ profile_id: user.id });
    } else if (role === 'clinician') {
      await supabase
        .from('clinician_details')
        .upsert({
          profile_id: user.id,
          is_verified: false
        });
    }

    return {
      user: authData.user,
      session: authData.session,
      error: null,
    };
  } catch (err) {
    console.error('[SignUp Unexpected Exception]:', err);
    return { user: null, session: null, error: err };
  }
}

export async function signInUser(param1, param2) {
  let email, password;
  if (typeof param1 === 'string') {
    email = param1;
    password = param2;
  } else if (param1 && typeof param1 === 'object') {
    if (typeof param1.email === 'object' && param1.email?.email) {
      email = param1.email.email;
      password = param1.email.password || param1.password;
    } else {
      email = param1.email;
      password = param1.password;
    }
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { user: null, session: null, profile: null, error };
    }

    let profile = null;
    if (data.user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();
      profile = profileData;
    }

    return {
      user: data.user,
      session: data.session,
      profile,
      error: null,
    };
  } catch (err) {
    return { user: null, session: null, profile: null, error: err };
  }
}

export async function signOutUser() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return { success: false, error };
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err };
  }
}

export async function fetchProfile(userId, activeSession = null) {
  if (!userId) return null;
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*, clinician_details(*), patient_details(*)')
      .eq('id', userId)
      .single();

    const session = activeSession || (await supabase.auth.getSession()).data.session;
    const userMetaRole = session?.user?.user_metadata?.role;

    if (error || !profile) {
      console.warn('[fetchProfile Warning]:', error?.message || 'Profile record not found in DB');
      return { id: userId, role: userMetaRole || 'patient' };
    }
    
    // One-to-one embeds come back as an object; older PostgREST sends an array.
    const first = (value) => (Array.isArray(value) ? value[0] : value) ?? null;
    profile.clinicianDetails = first(profile.clinician_details);
    profile.patientDetails = first(profile.patient_details);

    // The embedded details row can be hidden by RLS. The authenticated API
    // reads the caller's own details without granting client-side write access.
    if (profile.role === 'clinician' && !profile.clinicianDetails && session?.access_token) {
      try {
        const details = await request('/api/profile', { accessToken: session.access_token });
        if (details?.role === 'clinician') {
          profile.clinicianDetails = {
            specialty: details.specialty,
            license_number: details.licenseNumber,
            state_medical_council: details.stateMedicalCouncil,
            is_verified: details.isVerified === true,
          };
        }
      } catch (error) {
        console.warn('[fetchProfile Warning]: Could not load clinician details from the API');
      }
    }

    // The stored role is authoritative. user_metadata is writable by the user
    // themselves, so it may only fill in for a profile that has no role yet.
    if (!profile.role && userMetaRole) {
      profile.role = userMetaRole;
    }

    return profile;
  } catch (err) {
    console.error('[fetchProfile Exception]:', err);
    return null;
  }
}

export async function completeOnboarding(userId, role, details) {
  try {
    // 1. Update basic profile using upsert in case it doesn't exist
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        role: role,
        full_name: details.fullName,
        phone: details.phone
      });

    if (profileError) throw profileError;

    // 2. Update specific details
    if (role === 'patient') {
      const { error: patientError } = await supabase
        .from('patient_details')
        .upsert({
          profile_id: userId
        });
      if (patientError) throw patientError;
    } else if (role === 'clinician') {
      const { error: clinicianError } = await supabase
        .from('clinician_details')
        .upsert({
          profile_id: userId,
          specialty: details.specialty,
          license_number: details.licenseNumber,
          state_medical_council: details.stateMedicalCouncil,
          is_verified: false
        });
        
      if (clinicianError) throw clinicianError;
    }
    return { success: true, error: null };
  } catch (err) {
    console.error('[Onboarding Error]:', err.message);
    return { success: false, error: err };
  }
}

export async function getCurrentUser() {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      return { user: null, profile: null, session: null };
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();
    return { user: session.user, profile, session };
  } catch (err) {
    return { user: null, profile: null, session: null };
  }
}

export { signInUser as signIn, signUpUser as signUp, signOutUser as signOut };


