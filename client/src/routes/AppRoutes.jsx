import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import PublicOnlyRoute from './PublicOnlyRoute';
import AppShell from '../layouts/AppShell';
import CommunityWorkspace from '../pages/community/CommunityWorkspace';
import CheckinLayout from '../layouts/CheckinLayout';
import AuthLayout from '../layouts/AuthLayout';

// Patient Pages
import HomePage from '../pages/home/HomePage';
import ProfilePage from '../pages/profile/ProfilePage';
import ReportsPage from '../pages/reports/ReportsPage';
import VisitSummaryPage from '../pages/summary/VisitSummaryPage';
import SymptomsStep from '../pages/checkin/SymptomsStep';
import ChecklistStep from '../pages/checkin/ChecklistStep';
import CheckinDonePage from '../pages/checkin/CheckinDonePage';

// Auth Pages
import LoginPage from '../pages/auth/LoginPage';
import SignupPage from '../pages/auth/SignupPage';
import InvitePage from '../pages/invite/InvitePage.jsx';

// Clinician Pages
import { ClinicianDashboard } from '../pages/clinician/ClinicianDashboard.jsx';
import { ComingSoon } from '../pages/clinician/ComingSoon.jsx';
import { ClinicianSchedule } from '../pages/clinician/ClinicianSchedule.jsx';
import { ClinicianPatients } from '../pages/clinician/ClinicianPatients.jsx';
import { ClinicianChecklists } from '../pages/clinician/ClinicianChecklists.jsx';
import VerificationPending from '../pages/clinician/VerificationPending.jsx';
import ClinicianProfile from '../pages/clinician/ClinicianProfile.jsx';
import NewAppointment from '../pages/clinician/NewAppointment.jsx';

// Onboarding Pages
import PatientOnboarding from '../pages/onboarding/PatientOnboarding.jsx';
import ClinicianOnboarding from '../pages/onboarding/ClinicianOnboarding.jsx';

export function AppRoutes() {
  return (
    <Routes>
      {/* Public Auth Routes */}
      {/* Signed-in users are sent home, so Back after login cannot reach these. */}
      <Route element={<PublicOnlyRoute><AuthLayout /></PublicOnlyRoute>}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>
      <Route path="/invite/:token" element={<InvitePage />} />

      {/* Onboarding Routes */}
      <Route path="/onboarding/patient" element={<ProtectedRoute allowIncomplete><PatientOnboarding /></ProtectedRoute>} />
      <Route path="/onboarding/clinician" element={<ProtectedRoute allowIncomplete><ClinicianOnboarding /></ProtectedRoute>} />
      <Route path="/verification-pending" element={<ProtectedRoute allowIncomplete><VerificationPending /></ProtectedRoute>} />
      
      {/* Patient App Shell Routes */}
      <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route path="/" element={<HomePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/summary" element={<VisitSummaryPage />} />
      </Route>

      {/* Patient Check-in Flow Routes */}
      <Route element={<ProtectedRoute><CheckinLayout /></ProtectedRoute>}>
        <Route path="/checkin/symptoms" element={<SymptomsStep />} />
        <Route path="/checkin/checklist" element={<ChecklistStep />} />
      </Route>
      <Route path="/checkin/done" element={<ProtectedRoute><CheckinDonePage /></ProtectedRoute>} />

      {/* Separate community workspace; API checks community roles independently. */}
      <Route path="/community-care" element={<ProtectedRoute><CommunityWorkspace /></ProtectedRoute>} />

      {/* Clinician Routes */}
      <Route path="/clinician" element={<ProtectedRoute requireVerifiedClinician><ClinicianDashboard /></ProtectedRoute>} />
      <Route path="/clinician/profile" element={<ProtectedRoute requireVerifiedClinician><ClinicianProfile /></ProtectedRoute>} />
      <Route path="/clinician/appointments/new" element={<ProtectedRoute requireVerifiedClinician><NewAppointment /></ProtectedRoute>} />
      <Route path="/clinician/schedule" element={<ProtectedRoute requireVerifiedClinician><ClinicianSchedule /></ProtectedRoute>} />
      <Route path="/clinician/patients" element={<ProtectedRoute requireVerifiedClinician><ClinicianPatients /></ProtectedRoute>} />
      <Route path="/clinician/checklists" element={<ProtectedRoute requireVerifiedClinician><ClinicianChecklists /></ProtectedRoute>} />
      <Route path="/clinician/lab-inbox" element={<ProtectedRoute requireVerifiedClinician><ComingSoon title="Lab Inbox" icon="flask" /></ProtectedRoute>} />
      <Route path="/clinician/analytics" element={<ProtectedRoute requireVerifiedClinician><ComingSoon title="Analytics" icon="chart" /></ProtectedRoute>} />
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default AppRoutes;
