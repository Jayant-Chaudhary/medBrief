import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { patientService } from '../services/patientService';
import { useAuthContext } from './AuthContext';

const PatientContext = createContext(null);

/**
 * The signed-in patient, their appointments and their latest vitals.
 *
 * A patient has many appointments over time — often with more than one
 * clinician — so the provider exposes the whole list and tracks which one the
 * user is currently looking at, rather than silently picking the first.
 */
export function PatientProvider({ children }) {
  const { user, role, loading: authLoading } = useAuthContext();
  const [profile, setProfile] = useState(null);
  const [appointments, setAppointments] = useState({ all: [], upcoming: [], past: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (authLoading || !user || role !== 'patient') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profileData, appointmentData, vitalsData] = await Promise.all([
        patientService.getProfile(),
        patientService.getAppointments(),
        patientService.getLatestVitals().catch(() => null),
      ]);

      setProfile(profileData);
      setAppointments(appointmentData);
      setVitals(vitalsData);
      setSelectedId((current) => current ?? appointmentData.upcoming[0]?.id ?? appointmentData.all[0]?.id ?? null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [authLoading, user, role]);

  useEffect(() => {
    if (!authLoading && user && role === 'patient') {
      load();
    } else if (!authLoading && (!user || role !== 'patient')) {
      setProfile(null);
      setAppointments({ all: [], upcoming: [], past: [] });
      setVitals(null);
      setLoading(false);
    }
  }, [load, authLoading, user, role]);

  /** The appointment the UI is currently acting on. */
  const activeAppointment = useMemo(
    () => appointments.all.find((a) => a.id === selectedId) ?? null,
    [appointments.all, selectedId]
  );

  const updateStatus = useCallback(
    async (status, appointmentId = selectedId) => {
      if (!appointmentId) return null;
      const updated = await patientService.updateAppointmentStatus(appointmentId, status);
      await load();
      return updated;
    },
    [selectedId, load]
  );

  const value = {
    profile,
    appointments,
    activeAppointment,
    selectAppointment: setSelectedId,
    vitals,
    setVitals,
    loading,
    error,
    refresh: load,
    updateStatus,
  };

  return <PatientContext.Provider value={value}>{children}</PatientContext.Provider>;
}

export const usePatientContext = () => useContext(PatientContext);
