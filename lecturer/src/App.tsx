import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NotificationProvider } from '@shared/components/NotificationProvider';
import LecturerLogin from './pages/LecturerLogin';
import LecturerSignup from './pages/LecturerSignup';
import LecturerDashboard from './pages/LecturerDashboard';
import Results from './pages/Results';
import SubmissionReview from './pages/SubmissionReview';
import ResetPassword from './pages/ResetPassword';

function App() {
  return (
    <NotificationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LecturerLogin />} />
          <Route path="/signup" element={<LecturerSignup />} />
          <Route path="/dashboard" element={<LecturerDashboard />} />
          <Route path="/results/:examId" element={<Results />} />
          <Route path="/review/:submissionId" element={<SubmissionReview />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  );
}

export default App;
