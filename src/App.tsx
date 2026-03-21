import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NotificationProvider } from './components/NotificationProvider';
import StudentLogin from './pages/StudentLogin';
import StudentDashboard from './pages/StudentDashboard';
import ExamRoom from './pages/ExamRoom';
import StudentResults from './pages/StudentResults';
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
          {/* Student Routes */}
          <Route path="/" element={<StudentLogin />} />
          <Route path="/dashboard" element={<StudentDashboard />} />
          <Route path="/exam/:examId" element={<ExamRoom />} />
          <Route path="/exam/results/:submissionId" element={<StudentResults />} />

          {/* Lecturer Routes */}
          <Route path="/lecturer/login" element={<LecturerLogin />} />
          <Route path="/lecturer/signup" element={<LecturerSignup />} />
          <Route path="/lecturer/dashboard" element={<LecturerDashboard />} />
          <Route path="/lecturer/results/:examId" element={<Results />} />
          <Route path="/lecturer/review/:submissionId" element={<SubmissionReview />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  );
}

export default App;
